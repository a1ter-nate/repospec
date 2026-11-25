import fs from "node:fs";
import path from "node:path";
import type {
  AstDeclaredEntityFact,
  CanonicalLayer,
  DbForeignKeyFact,
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
import { classifyVendorPackage, resolveCanonicalLayer, resolveLayerSemantics } from "../taxonomy.ts";

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function stripRustTestBlocks(text: string): string {
  const idx = text.search(/#\[cfg\(test\)\]/);
  return idx >= 0 ? text.slice(0, idx) : text;
}

function extractBraceBlock(text: string, openBraceIdx: number): string {
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = openBraceIdx; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") {
      inStr = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(openBraceIdx + 1, i);
    }
  }
  return text.slice(openBraceIdx + 1);
}

function moduleOfRustFile(relFile: string, crateDir: string): string {
  const prefix = crateDir === "." ? "" : `${crateDir}/`;
  const inner = relFile.startsWith(prefix) ? relFile.slice(prefix.length) : relFile;
  const cleaned = inner.replace(/^src\//, "");
  const parts = cleaned.split("/");
  if (parts.length > 1) return parts[0] ?? "lib";
  return (parts[0] ?? "lib").replace(/\.rs$/, "");
}

function isRustSubdirModule(relFile: string, crateDir: string): string | null {
  const prefix = crateDir === "." ? "src/" : `${crateDir}/src/`;
  if (!relFile.startsWith(prefix)) return null;
  const inner = relFile.slice(prefix.length);
  const parts = inner.split("/");
  if (parts.length >= 2 && parts[0]) return parts[0];
  return null;
}

function classifyRustFile(
  relFile: string,
  prodText: string,
  unit: UnitDescriptor | null,
): { rawLayer: string; canonicalLayer: CanonicalLayer; source: "path_convention" | "token_heuristic" } {
  const lower = relFile.toLowerCase();
  if (/(?:^|\/)(?:examples|benches|xtask)\//.test(lower)) {
    return { rawLayer: "examples", canonicalLayer: "ops_script", source: "path_convention" };
  }
  if (/(?:^|\/)(?:tests|fuzz)\//.test(lower) || lower.endsWith("_tests.rs")) {
    return { rawLayer: "tests", canonicalLayer: "tests", source: "path_convention" };
  }
  if (lower.includes("/routes/") || lower.includes("/handlers/")) {
    return { rawLayer: "routes", canonicalLayer: "transport", source: "path_convention" };
  }
  if (lower.includes("/db/") || lower.includes("/repositories/") || lower.includes("/persistence/") || lower.includes("/store/")) {
    return { rawLayer: "data", canonicalLayer: "persistence", source: "path_convention" };
  }
  if (lower.includes("/client/") || lower.includes("/clients/") || lower.includes("/adapters/")) {
    return { rawLayer: "client", canonicalLayer: "integration", source: "path_convention" };
  }
  if (lower.includes("/worker/") || lower.includes("/cron/") || lower.includes("/scheduler/")) {
    return { rawLayer: "loops", canonicalLayer: "runtime_loop", source: "path_convention" };
  }
  if (lower.includes("/machine") || lower.includes("/state_machines/")) {
    return { rawLayer: "state_machines", canonicalLayer: "domain", source: "path_convention" };
  }

  const isHttpUnit = unit?.archetype === "http_service";
  if (isHttpUnit && /\.route\s*\(\s*"\//.test(prodText)) {
    return { rawLayer: "routes", canonicalLayer: "transport", source: "token_heuristic" };
  }
  if (/sqlx::query/.test(prodText)) {
    return { rawLayer: "data", canonicalLayer: "persistence", source: "token_heuristic" };
  }
  if (/impl\s+Machine\s+for/.test(prodText)) {
    return { rawLayer: "state_machines", canonicalLayer: "domain", source: "token_heuristic" };
  }
  if (/tokio::time::interval/.test(prodText)) {
    return { rawLayer: "loops", canonicalLayer: "runtime_loop", source: "token_heuristic" };
  }
  if (/reqwest::/.test(prodText)) {
    return { rawLayer: "client", canonicalLayer: "integration", source: "token_heuristic" };
  }
  return { rawLayer: "domain", canonicalLayer: "domain", source: "path_convention" };
}

function replaySqlMigrations(
  ctx: RepoContext,
): {
  declaredEntities: AstDeclaredEntityFact[];
  declaredTables: Set<string>;
  dbForeignKeys: DbForeignKeyFact[];
} {
  const migrationFiles = ctx.allFiles
    .filter((f) => /(?:^|\/)migrations\/.*\.sql$/i.test(f))
    .sort();
  const tableState = new Map<string, { declaredAt: string; hasTenancyKey: boolean }>();
  const dbForeignKeys: DbForeignKeyFact[] = [];

  for (const mig of migrationFiles) {
    let sqlText = "";
    try {
      sqlText = fs.readFileSync(path.join(ctx.rootDir, mig), "utf8");
    } catch {
      continue;
    }

    const statements = sqlText.split(";");
    let offset = 0;
    for (const stmt of statements) {
      const stmtLine = lineOf(sqlText, offset);
      offset += stmt.length + 1;

      const createTbl = stmt.match(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(([\s\S]*)\)/i,
      );
      if (createTbl?.[1]) {
        const tbl = createTbl[1].toLowerCase();
        const body = createTbl[2] ?? "";
        const hasTenancyKey = /\b(?:workspace_id|tenant_id|organization_id|org_id)\b/i.test(body);
        tableState.set(tbl, { declaredAt: mig, hasTenancyKey });

        for (const fkMatch of body.matchAll(
          /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+[^,\n]*?\bREFERENCES\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(\s*"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?/gi,
        )) {
          if (fkMatch[1] && fkMatch[2] && fkMatch[3]) {
            dbForeignKeys.push({
              datastore: "postgres",
              fromTable: tbl,
              fromColumn: fkMatch[1].toLowerCase(),
              toTable: fkMatch[2].toLowerCase(),
              toColumn: fkMatch[3].toLowerCase(),
              onDelete: fkMatch[4] ? fkMatch[4].toUpperCase().replace(/\s+/g, " ") : null,
              declaredAt: mig,
              line: stmtLine,
            });
          }
        }
        continue;
      }

      const createView = stmt.match(
        /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i,
      );
      if (createView?.[1]) {
        const viewName = createView[1].toLowerCase();
        const hasTenancyKey = /\b(?:workspace_id|tenant_id|organization_id|org_id)\b/i.test(stmt);
        tableState.set(viewName, { declaredAt: mig, hasTenancyKey });
        continue;
      }

      const dropMatch = stmt.match(
        /DROP\s+(?:TABLE|MATERIALIZED\s+VIEW|VIEW)\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i,
      );
      if (dropMatch?.[1]) {
        tableState.delete(dropMatch[1].toLowerCase());
        continue;
      }

      const renameMatch = stmt.match(
        /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+RENAME\s+TO\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i,
      );
      if (renameMatch?.[1] && renameMatch[2]) {
        const oldName = renameMatch[1].toLowerCase();
        const newName = renameMatch[2].toLowerCase();
        const prev = tableState.get(oldName);
        tableState.delete(oldName);
        tableState.set(newName, {
          declaredAt: mig,
          hasTenancyKey: prev?.hasTenancyKey ?? false,
        });
        for (const fk of dbForeignKeys) {
          if (fk.fromTable === oldName) fk.fromTable = newName;
          if (fk.toTable === oldName) fk.toTable = newName;
        }
        continue;
      }

      const alterAddCol = stmt.match(
        /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?[\s\S]*?ADD\s+COLUMN[\s\S]*/i,
      );
      if (alterAddCol?.[1]) {
        const tbl = alterAddCol[1].toLowerCase();
        const prev = tableState.get(tbl);
        if (prev && /\b(?:workspace_id|tenant_id|organization_id|org_id)\b/i.test(stmt)) {
          prev.hasTenancyKey = true;
        }
        for (const fkMatch of stmt.matchAll(
          /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+[^,\n;]*?\bREFERENCES\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(\s*"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?/gi,
        )) {
          if (fkMatch[1] && fkMatch[2] && fkMatch[3]) {
            dbForeignKeys.push({
              datastore: "postgres",
              fromTable: tbl,
              fromColumn: fkMatch[1].toLowerCase(),
              toTable: fkMatch[2].toLowerCase(),
              toColumn: fkMatch[3].toLowerCase(),
              onDelete: fkMatch[4] ? fkMatch[4].toUpperCase().replace(/\s+/g, " ") : null,
              declaredAt: mig,
              line: stmtLine,
            });
          }
        }
      }
    }
  }

  const declaredTables = new Set<string>(tableState.keys());
  const declaredEntities: AstDeclaredEntityFact[] = Array.from(tableState.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entity, info]) => ({
      datastore: "postgres",
      entity,
      declaredAt: info.declaredAt,
      authorizedShared: false,
      hasTenancyKey: info.hasTenancyKey,
    }));

  const liveFks = dbForeignKeys.filter((fk) => declaredTables.has(fk.fromTable) && declaredTables.has(fk.toTable));
  return { declaredEntities, declaredTables, dbForeignKeys: liveFks };
}

export const rustAstExtractor: ExtractorPlugin = {
  id: "arch.rust-ast.v4",
  domain: "arch",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const rsFiles = ctx.allFiles.filter((f) => f.endsWith(".rs"));
    if (rsFiles.length === 0) {
      return { nodes: [], edges: [], rules: [] };
    }

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
        exportsCount: (prodText.match(/\bpub\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const)\b/g) ?? []).length,
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

      for (const m of prodText.matchAll(/impl\s+Machine\s+for\s+([A-Za-z0-9_]+)\s*\{/g)) {
        const typeName = m[1];
        if (!typeName || m.index === undefined) continue;
        const openIdx = m.index + m[0].length - 1;
        const body = extractBraceBlock(prodText, openIdx);
        const nameMatch = body.match(/const\s+NAME\s*:\s*&(?:'static\s+)?str\s*=\s*"([^"]+)"/);
        const machineName = nameMatch?.[1] ?? typeName;
        const transitions: Array<{ from: string; event: string; to: string }> = [];
        const statesSet = new Set<string>();
        for (const tm of body.matchAll(
          /\(\s*(?:Self|[\w]+)::(\w+)\s*,\s*"([^"]+)"\s*,\s*(?:Self|[\w]+)::(\w+)\s*,?\s*\)/g,
        )) {
          if (tm[1] && tm[2] && tm[3]) {
            statesSet.add(tm[1]);
            statesSet.add(tm[3]);
            transitions.push({ from: tm[1], event: tm[2], to: tm[3] });
          }
        }
        const sortedStates = Array.from(statesSet).sort();
        const ln = lineOf(prodText, m.index);
        if (transitions.length > 0) {
          stateMachines.push({
            id: `arch:sm:rust:${machineName}`,
            name: machineName,
            language: "rust",
            unit: unitName,
            evidence: "declared",
            states: sortedStates,
            transitions,
            provenance: { file: rel, line: ln },
          });
        }
        if (sortedStates.length >= 2) {
          ast.stateEnums.push({
            file: rel,
            unit: unitName,
            language: "rust",
            name: `${typeName} (${machineName})`,
            valuesSignature: sortedStates.join("|"),
            values: sortedStates,
            line: ln,
            hasTransitions: transitions.length > 0,
          });
        }
      }

      for (const m of prodText.matchAll(/const\s+TRANSITIONS\s*:\s*&\[[\s\S]*?\]\s*=\s*&\[([\s\S]*?)\];/g)) {
        const body = m[1] ?? "";
        const transitions: Array<{ from: string; event: string; to: string }> = [];
        const statesSet = new Set<string>();
        for (const tm of body.matchAll(/\(\s*[\w]+::(\w+)\s*,\s*(?:[\w]+::(\w+)|"([^"]+)")\s*,\s*[\w]+::(\w+)\s*,?\s*\)/g)) {
          const ev = tm[2] ?? tm[3];
          if (tm[1] && ev && tm[4]) {
            statesSet.add(tm[1]);
            statesSet.add(tm[4]);
            transitions.push({ from: tm[1], event: ev, to: tm[4] });
          }
        }
        if (transitions.length > 0) {
          const ln = lineOf(prodText, m.index ?? 0);
          const machineName = `${unitName}:${modName}`;
          stateMachines.push({
            id: `arch:sm:rust:${machineName}:${ln}`,
            name: machineName,
            language: "rust",
            unit: unitName,
            evidence: "declared",
            states: Array.from(statesSet).sort(),
            transitions,
            provenance: { file: rel, line: ln },
          });
        }
      }

      for (const m of prodText.matchAll(/tokio::time::interval\s*\(([^)]+)\)/g)) {
        const ln = lineOf(prodText, m.index ?? 0);
        loops.push({
          id: `arch:loop:rust:${unitName}:${modName}:${ln}`,
          name: `${unitName}::${modName} interval`,
          kind: "interval",
          schedule: (m[1] ?? "").trim().slice(0, 60) || null,
          unit: unitName,
          provenance: { file: rel, line: ln },
        });
      }
    }

    if (declaredTables.size > 0) {
      nodes.push({
        id: "arch:datastore:postgres",
        domain: "arch",
        kind: "datastore",
        role: "datastore",
        label: "Postgres",
        group: "datastore",
        provenance: { file: declaredEntities[0]?.declaredAt ?? "migrations" },
        tags: ["postgres", "sql", "datastore"],
        meta: {
          tableCount: declaredTables.size,
          foreignKeyCount: dbForeignKeys.length,
          tenantedTableCount: declaredEntities.filter((e) => e.hasTenancyKey).length,
        },
      });
      for (const [crateId, refCount] of crateTableRefs) {
        edges.push({
          from: crateId,
          to: "arch:datastore:postgres",
          kind: "reads_writes",
          label: `${refCount} queries`,
          weight: refCount,
          confidence: "observed",
          provenance: { file: "migrations" },
        });
      }
    }

    const layerIdByCrateAndName = new Map<string, string>();
    for (const [, info] of Array.from(crateLayerCounts.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const unitObj = rustUnits.find((u) => u.id === info.crateId);
      if (unitObj && unitObj.layerPolicy === "flat_library" && info.count < 2) continue;
      const lid = `arch:layer:${info.crateName}:${info.layer}`;
      const sem = resolveLayerSemantics(info.layer, info.canonicalLayer);
      layerIdByCrateAndName.set(`${info.crateName}:${info.layer}`, lid);
      nodes.push({
        id: lid,
        domain: "arch",
        kind: "code_layer",
        role: "layer",
        label: info.layer,
        group: info.crateName,
        ownerId: info.crateId,
        provenance: { file: info.sampleFile },
        tags: ["rust", "layer", info.canonicalLayer, sem.axis],
        meta: {
          unit: info.crateName,
          fileCount: info.count,
          canonicalLayer: info.canonicalLayer,
          layerAxis: sem.axis,
          layerRank: sem.rank,
          laneId: sem.laneId,
          laneLabel: sem.laneLabel,
          routeCount: info.layer === "routes" ? (crateRouteCounts.get(info.crateName) ?? 0) : 0,
        },
      });
      edges.push({
        from: info.crateId,
        to: lid,
        kind: "contains",
        confidence: "observed",
        provenance: { file: info.sampleFile },
      });
    }

    for (const [key, evList] of Array.from(layerEdgeEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const [fromKey, toKey] = key.split(">");
      if (!fromKey || !toKey) continue;
      const fromId = layerIdByCrateAndName.get(fromKey);
      const toId = layerIdByCrateAndName.get(toKey);
      if (!fromId || !toId) continue;
      edges.push({
        from: fromId,
        to: toId,
        kind: "imports_layer",
        label: String(evList.length),
        weight: evList.length,
        confidence: "observed",
        provenance: evList[0] ? { file: evList[0].file, line: evList[0].line } : undefined,
        evidence: evList.slice(0, 10),
      });
    }

    const composeRel = ctx.allFiles.find((f) => f === "compose.yaml" || f === "docker-compose.yml" || f === "docker-compose.yaml");
    if (composeRel) {
      const composeId = `iac:docker:${composeRel}`;
      nodes.push({
        id: composeId,
        domain: "iac",
        kind: "iac_container",
        role: "iac",
        label: composeRel,
        group: "data",
        provenance: { file: composeRel, line: 1 },
        tags: ["docker", "compose"],
        meta: { plane: "data", file: composeRel },
      });
      if (declaredTables.size > 0) {
        edges.push({
          from: composeId,
          to: "arch:datastore:postgres",
          kind: "references",
          label: "postgres",
          confidence: "observed",
          provenance: { file: composeRel, line: 1 },
        });
      }
    }

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
