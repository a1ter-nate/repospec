import fs from "node:fs";
import path from "node:path";
import type {
  CanonicalLayer,
  ExtractorPlugin,
  GraphFragment,
  LoopRecord,
  RepoContext,
  SpecEdge,
  SpecNode,
  SpecRule,
  StateMachineRecord,
  UnitDescriptor,
} from "../schema.ts";
import { createEmptyAst } from "../schema.ts";
import { classifyVendorPackage, resolveCanonicalLayer } from "../taxonomy.ts";
import { detectCapabilities, extractRustPublicSymbols, isExcludedCodePath } from "./moduleFacts.ts";
import { emitRustGraph, extractRustMachinesAndLoops } from "../internal/extractors/rustEmit.ts";
import { RUST_AST_HELPERS } from "../internal/extractors/rustHelpers.ts";

const {
  lineOf,
  stripRustTestBlocks,
  moduleOfRustFile,
  isRustSubdirModule,
  classifyRustFile,
  replaySqlMigrations,
} = RUST_AST_HELPERS;

export const rustAstExtractor: ExtractorPlugin = {
  id: "arch.rust-ast.v4",
  domain: "arch",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const rsFiles = ctx.allFiles.filter((f) => f.endsWith(".rs") && !isExcludedCodePath(f));
    if (rsFiles.length === 0) {
      return { nodes: [], edges: [], rules: [] };
    }
    const validUnitIds = new Set(ctx.units.map((u) => u.id));

    const rustUnits = ctx.units.filter((u) => u.ecosystem === "rust");
    const sortedUnits = [...rustUnits].sort((a, b) => b.dir.length - a.dir.length);
    const unitByIdent = new Map<string, UnitDescriptor>();
    for (const u of rustUnits) {
      unitByIdent.set(u.name.replace(/-/g, "_"), u);
    }

    const ast = createEmptyAst();
    const stateMachines: StateMachineRecord[] = [];
    const loops: LoopRecord[] = [];
    const nodes: SpecNode[] = [];
    const edges: SpecEdge[] = [];
    const rules: SpecRule[] = [];

    const { declaredEntities, declaredTables, dbForeignKeys } = replaySqlMigrations(ctx);
    ast.declaredEntities.push(...declaredEntities);
    ast.dbForeignKeys.push(...dbForeignKeys);

    if (ctx.allFiles.includes("scripts/check-migrations.py")) {
      const id = "rule:gate:check-migrations";
      nodes.push({
        id,
        domain: "rules",
        kind: "quality_gate",
        role: "rule",
        label: "check-migrations.py",
        group: "quality_gate",
        provenance: { file: "scripts/check-migrations.py", line: 1 },
        tags: ["R1", "sql", "rust"],
        meta: { gateName: "check-migrations", rung: "R1", scriptPath: "scripts/check-migrations.py" },
      });
      rules.push({
        id,
        name: "check-migrations",
        category: "quality_gate",
        enforcement: "ci_gate",
        rung: "R1",
        statement: "SQL migrations enforce additive-only evolution and credential allowlists via scripts/check-migrations.py",
        targets: ["arch:datastore:postgres"],
        provenance: { file: "scripts/check-migrations.py", line: 1 },
      });
    }

    const unitByDir = new Map<string, UnitDescriptor>();
    for (const u of sortedUnits) {
      if (!unitByDir.has(u.dir)) unitByDir.set(u.dir, u);
    }
    const rootRustUnit = unitByDir.get(".") ?? null;
    const resolveRustUnit = (relPath: string): UnitDescriptor | null => {
      let cur = path.posix.dirname(relPath);
      while (cur && cur !== ".") {
        const hit = unitByDir.get(cur);
        if (hit) return hit;
        const parent = path.posix.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
      return rootRustUnit;
    };

    const unitByRsFile = new Map<string, UnitDescriptor | null>();
    const subdirFileCounts = new Map<string, number>();
    const crateModuleFileMap = new Map<string, string>();

    for (const rel of rsFiles) {
      const unit = resolveRustUnit(rel);
      unitByRsFile.set(rel, unit);
      if (unit) {
        const sub = isRustSubdirModule(rel, unit.dir);
        if (sub) {
          const key = `${unit.dir}::${sub}`;
          subdirFileCounts.set(key, (subdirFileCounts.get(key) ?? 0) + 1);
        }
      }
      const crateDir = unit?.dir ?? ".";
      const modName = moduleOfRustFile(rel, crateDir);
      const modKey = `${crateDir}::${modName}`;
      if (!crateModuleFileMap.has(modKey) || rel.endsWith("/mod.rs") || rel.endsWith(`/${modName}.rs`)) {
        crateModuleFileMap.set(modKey, rel);
      }
    }

    interface ParsedRustFile {
      rel: string;
      text: string;
      prodText: string;
      unit: UnitDescriptor | null;
      unitName: string;
      unitId: string;
      crateDir: string;
      modName: string;
      rawLayer: string;
      canonicalLayer: CanonicalLayer;
      layerSource: "path_convention" | "token_heuristic";
      domainArea: string | null;
      domainSource: "subdir_module" | "none";
      isTest: boolean;
      isOpsScript: boolean;
    }

    const parsedFiles: ParsedRustFile[] = [];
    const parsedByRel = new Map<string, ParsedRustFile>();

    for (const rel of rsFiles) {
      let text = "";
      try {
        text = fs.readFileSync(path.join(ctx.rootDir, rel), "utf8");
      } catch {
        continue;
      }

      const unit = unitByRsFile.get(rel) ?? null;
      const crateDir = unit?.dir ?? ".";
      const unitName = unit?.name ?? ctx.repoName;
      const unitId = unit?.id ?? `arch:app:${ctx.repoName}`;

      const isOpsScript = /(?:^|\/)(?:examples|benches|xtask)\//.test(rel);
      const isIntegrationTestFile =
        !isOpsScript && (/(?:^|\/)(?:tests|fuzz)\//.test(rel) || rel.endsWith("_tests.rs"));
      const prodText = stripRustTestBlocks(text);
      const modName = moduleOfRustFile(rel, crateDir);
      const classified = classifyRustFile(rel, prodText, unit);

      let domainArea: string | null = null;
      let domainSource: "subdir_module" | "none" = "none";
      if (!isIntegrationTestFile && !isOpsScript && unit) {
        const sub = isRustSubdirModule(rel, unit.dir);
        if (sub && (subdirFileCounts.get(`${unit.dir}::${sub}`) ?? 0) >= 2 && resolveCanonicalLayer(sub) === "unclassified") {
          domainArea = sub;
          domainSource = "subdir_module";
        }
      }

      const rec: ParsedRustFile = {
        rel,
        text,
        prodText,
        unit,
        unitName,
        unitId,
        crateDir,
        modName,
        rawLayer: classified.rawLayer,
        canonicalLayer: classified.canonicalLayer,
        layerSource: classified.source,
        domainArea,
        domainSource,
        isTest: isIntegrationTestFile,
        isOpsScript,
      };
      parsedFiles.push(rec);
      parsedByRel.set(rel, rec);

      const rustExports = isIntegrationTestFile ? [] : extractRustPublicSymbols(prodText, rel);
      const rustCaps = detectCapabilities(prodText);

      ast.files.push({
        file: rel,
        unit: unitName,
        language: "rust",
        layer: classified.rawLayer,
        canonicalLayer: classified.canonicalLayer,
        domainArea,
        layerSource: classified.source,
        domainSource,
        isTest: isIntegrationTestFile,
        isBarrel: rel.endsWith("/lib.rs") || rel.endsWith("/mod.rs"),
        lines: text.split("\n").length,
        exportsCount: rustExports.length,
        exportedSymbols: rustExports,
        capabilities: rustCaps,
      });

      const hasInlineTests =
        !isIntegrationTestFile &&
        !isOpsScript &&
        (/#\[cfg\(test\)\]/.test(text) || /#\[(?:tokio::)?test\]/.test(text) || /proptest!\s*\{/.test(text));
      if (hasInlineTests) {
        ast.fileImports.push({
          fromFile: `${rel}#tests`,
          toFile: rel,
          fromUnit: unitName,
          toUnit: unitName,
          fromLayer: "tests",
          toLayer: classified.rawLayer,
          fromCanonicalLayer: "tests",
          toCanonicalLayer: classified.canonicalLayer,
          fromDomain: domainArea,
          toDomain: domainArea,
          line: lineOf(text, text.indexOf("#[cfg(test)]") >= 0 ? text.indexOf("#[cfg(test)]") : 0),
          typeOnly: false,
        });
        ast.files.push({
          file: `${rel}#tests`,
          unit: unitName,
          language: "rust",
          layer: "tests",
          canonicalLayer: "tests",
          domainArea,
          layerSource: "path_convention",
          domainSource,
          isTest: true,
          isBarrel: false,
          lines: 1,
          exportsCount: 0,
        });
      }
    }

    const crateLayerCounts = new Map<
      string,
      { crateName: string; crateId: string; layer: string; canonicalLayer: CanonicalLayer; count: number; sampleFile: string }
    >();
    const layerEdgeEvidence = new Map<string, Array<{ file: string; line: number; detail: string }>>();
    const crateTableRefs = new Map<string, number>();
    const crateRouteCounts = new Map<string, number>();
    const domainPairEvidence = new Map<string, Array<{ file: string; line: number; detail: string }>>();

    for (const pf of parsedFiles) {
      const { rel, prodText, unit, unitName, unitId, crateDir, modName, rawLayer, canonicalLayer, domainArea, isTest, isOpsScript } = pf;

      if (!isTest && !isOpsScript) {
        const lKey = `${unitName}::${rawLayer}`;
        const cur = crateLayerCounts.get(lKey);
        if (cur) cur.count += 1;
        else crateLayerCounts.set(lKey, { crateName: unitName, crateId: unitId, layer: rawLayer, canonicalLayer, count: 1, sampleFile: rel });
      }

      const recordImport = (target: ParsedRustFile, ln: number, rawUse: string): void => {
        if (target.rel === rel) return;
        ast.fileImports.push({
          fromFile: rel,
          toFile: target.rel,
          fromUnit: unitName,
          toUnit: target.unitName,
          fromLayer: rawLayer,
          toLayer: target.rawLayer,
          fromCanonicalLayer: canonicalLayer,
          toCanonicalLayer: target.canonicalLayer,
          fromDomain: domainArea,
          toDomain: target.domainArea,
          line: ln,
          typeOnly: false,
        });
        if (!isTest && !isOpsScript && !target.isTest && !target.isOpsScript) {
          if (unitName === target.unitName && rawLayer !== target.rawLayer) {
            const ek = `${unitName}:${rawLayer}>${unitName}:${target.rawLayer}`;
            const list = layerEdgeEvidence.get(ek) ?? [];
            list.push({ file: rel, line: ln, detail: `${rawUse} (${target.rel})` });
            layerEdgeEvidence.set(ek, list);
          }
          if (domainArea && target.domainArea && domainArea !== target.domainArea) {
            const dk = `${domainArea}>${target.domainArea}`;
            const list = domainPairEvidence.get(dk) ?? [];
            list.push({ file: rel, line: ln, detail: `${rawUse} (${target.rel})` });
            domainPairEvidence.set(dk, list);
          }
        }
      };

      for (const m of prodText.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+crate::([a-zA-Z0-9_]+)/gm)) {
        const targetMod = m[1];
        if (!targetMod || targetMod === modName) continue;
        const targetRel = crateModuleFileMap.get(`${crateDir}::${targetMod}`);
        const target = targetRel ? parsedByRel.get(targetRel) : undefined;
        if (target) recordImport(target, lineOf(prodText, m.index ?? 0), `use crate::${targetMod}`);
      }

      const resolveSuperTarget = (parentDir: string, targetIdent: string): ParsedRustFile | undefined => {
        const c1 = path.posix.join(parentDir, `${targetIdent}.rs`);
        if (c1 !== rel && parsedByRel.has(c1)) return parsedByRel.get(c1);
        const c2 = path.posix.join(parentDir, targetIdent, "mod.rs");
        if (c2 !== rel && parsedByRel.has(c2)) return parsedByRel.get(c2);
        const c3 = path.posix.join(path.posix.dirname(parentDir), `${targetIdent}.rs`);
        if (c3 !== rel && parsedByRel.has(c3)) return parsedByRel.get(c3);
        const c4 = path.posix.join(parentDir, "mod.rs");
        if (c4 !== rel && parsedByRel.has(c4)) return parsedByRel.get(c4);
        return undefined;
      };

      for (const m of prodText.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+super::([a-zA-Z0-9_]+)/gm)) {
        const targetIdent = m[1];
        if (!targetIdent) continue;
        const parentDir = path.posix.dirname(rel);
        const target = resolveSuperTarget(parentDir, targetIdent);
        if (target) recordImport(target, lineOf(prodText, m.index ?? 0), `use super::${targetIdent}`);
      }

      for (const m of prodText.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([a-zA-Z0-9_]+)::([a-zA-Z0-9_]+)?/gm)) {
        const ident = m[1];
        const sub = m[2];
        if (!ident || ident === "crate" || ident === "super" || ident === "self" || ident === "std" || ident === "core" || ident === "alloc") {
          continue;
        }
        const ln = lineOf(prodText, m.index ?? 0);
        const targetUnit = unitByIdent.get(ident);
        if (targetUnit) {
          const targetSubRel = sub ? crateModuleFileMap.get(`${targetUnit.dir}::${sub}`) : undefined;
          const targetLibRel = `${targetUnit.dir}/src/lib.rs`;
          const target =
            (targetSubRel ? parsedByRel.get(targetSubRel) : undefined) ??
            parsedByRel.get(targetLibRel);
          if (target) {
            recordImport(target, ln, `use ${ident}::${sub ?? "*"}`);
          }
        } else {
          ast.pkgImports.push({
            fromFile: rel,
            unit: unitName,
            layer: rawLayer,
            canonicalLayer,
            pkg: ident,
            vendorCategory: classifyVendorPackage(ident),
            line: ln,
            typeOnly: false,
          });
        }
      }

      if (isTest || isOpsScript) continue;

      if (unit?.archetype === "http_service" || rawLayer === "routes") {
        const layerGuards = Array.from(prodText.matchAll(/middleware::from_fn(?:_with_state)?\s*\(\s*([A-Za-z0-9_:]+)/g))
          .map((gm) => gm[1] ?? "")
          .filter(Boolean);
        const defaultGuard = layerGuards.length > 0 ? layerGuards[0] ?? null : null;
        for (const rm of prodText.matchAll(/\.route\s*\(\s*"(\/[^"]*)"\s*,\s*([a-zA-Z0-9_]+)\s*\(/g)) {
          const routePath = rm[1];
          const method = (rm[2] ?? "ANY").toUpperCase();
          if (!routePath) continue;
          crateRouteCounts.set(unitName, (crateRouteCounts.get(unitName) ?? 0) + 1);
          ast.httpEndpoints.push({
            unit: unitName,
            method: ["GET", "POST", "PUT", "PATCH", "DELETE", "ANY"].includes(method) ? method : "ANY",
            path: routePath,
            authGuard: defaultGuard,
            source: "ast",
            resolution: routePath === "/" ? "fragment" : "mounted",
            handlerFile: rel,
            line: lineOf(prodText, rm.index ?? 0),
            operationId: null,
          });
        }
      }

      for (const em of prodText.matchAll(/\benv::var(?:_os)?\s*\(\s*"([A-Z][A-Z0-9_]{2,})"\s*\)/g)) {
        const envName = em[1];
        if (envName) {
          ast.envBindings.push({
            envName,
            sourceKind: "code_read",
            unit: unitName,
            file: rel,
            line: lineOf(prodText, em.index ?? 0),
            isSecret: /SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|DATABASE_URL/i.test(envName),
          });
        }
      }

      for (const m of prodText.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+(?:public\.)?"?([a-z][a-z0-9_]{2,})"?/gi)) {
        const tbl = m[1]?.toLowerCase();
        if (tbl && declaredTables.has(tbl)) {
          const ln = lineOf(prodText, m.index ?? 0);
          ast.entityAccesses.push({
            datastore: "postgres",
            entity: tbl,
            file: rel,
            unit: unitName,
            layer: rawLayer,
            canonicalLayer,
            domainArea,
            op: m[0].split(/\s+/)[0]?.toUpperCase() ?? "QUERY",
            line: ln,
            confidence: "observed",
          });
          crateTableRefs.set(unitId, (crateTableRefs.get(unitId) ?? 0) + 1);
        }
      }

      extractRustMachinesAndLoops({ prodText, rel, unitName, modName, ast, stateMachines, loops });
    }


    emitRustGraph({
      ctx,
      rustUnits,
      validUnitIds,
      declaredTables,
      declaredEntities,
      dbForeignKeys,
      crateTableRefs,
      crateLayerCounts,
      crateRouteCounts,
      layerEdgeEvidence,
      nodes,
      edges,
    });

    return {
      nodes,
      edges,
      rules,
      stateMachines,
      loops,
      ast,
    };
  },
};
