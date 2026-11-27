import fs from "node:fs";
import path from "node:path";
import type {
  CanonicalLayer,
  ExportedSymbol,
  ExtractorPlugin,
  GraphFragment,
  LoopRecord,
  RepoContext,
  SpecEdge,
  SpecNode,
  SpecRule,
  StateMachineRecord,
  UnitDescriptor,
} from "@repospec/plugin";
import { createEmptyAst } from "@repospec/plugin";
import { classifyVendorPackage } from "@repospec/plugin";
import { detectCapabilities, isExcludedCodePath } from "@repospec/plugin";

import { classifyCsharpLayer, emitCsharpGraph, lineOf, walkCsFilesInDir } from "./csharpHelpers.ts";

export const csharpAstExtractor: ExtractorPlugin = {
  id: "arch.csharp-ast.v4",
  domain: "arch",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const csUnits = ctx.units.filter((u) => u.ecosystem === "csharp");
    const validUnitIds = new Set(ctx.units.map((u) => u.id));
    const inTreeCs = ctx.allFiles.filter((f) => f.endsWith(".cs") && (csUnits.length > 0 || !isExcludedCodePath(f)));
    const externalCs: string[] = [];
    for (const u of csUnits) {
      if (u.external) {
        externalCs.push(...walkCsFilesInDir(u.absDir, ctx.rootDir));
      }
    }
    const allCsFiles = Array.from(new Set([...inTreeCs, ...externalCs]))
      .filter((f) => csUnits.length > 0 ? !/^(?:templates|fixtures|corpus|reports)\//i.test(f) || csUnits.some((u) => f.startsWith(`${u.dir}/`)) : !isExcludedCodePath(f))
      .sort();
    if (allCsFiles.length === 0) {
      return { nodes: [], edges: [], rules: [] };
    }

    const sortedUnits = [...csUnits].sort((a, b) => b.dir.length - a.dir.length);
    const ast = createEmptyAst();
    const stateMachines: StateMachineRecord[] = [];
    const loops: LoopRecord[] = [];
    const nodes: SpecNode[] = [];
    const edges: SpecEdge[] = [];
    const rules: SpecRule[] = [];

    const nsToFiles = new Map<string, Array<{ rel: string; symbols: string[] }>>();
    const parsedFiles: Array<{
      rel: string;
      text: string;
      unit: UnitDescriptor | null;
      unitName: string;
      unitId: string;
      ns: string | null;
      rawLayer: string;
      canonicalLayer: CanonicalLayer;
      isTest: boolean;
      symbols: string[];
    }> = [];

    const unitByDir = new Map<string, UnitDescriptor>();
    for (const u of sortedUnits) {
      if (!unitByDir.has(u.dir)) unitByDir.set(u.dir, u);
    }
    const resolveCsUnit = (relPath: string): UnitDescriptor | null => {
      let cur = relPath;
      while (cur && cur !== ".") {
        const hit = unitByDir.get(cur);
        if (hit) return hit;
        const parent = path.posix.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
      return unitByDir.get(".") ?? null;
    };

    for (const rel of allCsFiles) {
      let text = "";
      try {
        text = fs.readFileSync(path.resolve(ctx.rootDir, rel), "utf8");
      } catch {
        continue;
      }

      const unit = resolveCsUnit(rel);
      const unitName = unit?.name ?? ctx.repoName;
      const unitId = unit?.id ?? `arch:app:${ctx.repoName}`;
      const nsMatch = text.match(/^\s*namespace\s+([A-Za-z0-9_.]+)/m);
      const ns = nsMatch?.[1] ?? null;
      const { rawLayer, canonicalLayer } = classifyCsharpLayer(rel, text, unit);
      const isTest = canonicalLayer === "tests";

      const exportedSymbols: ExportedSymbol[] = [];
      const symbols: string[] = [];
      for (const m of text.matchAll(
        /\b(?:public|internal)\s+(?:static\s+|sealed\s+|abstract\s+|partial\s+|readonly\s+)*(class|record|interface|enum|struct)\s+([A-Za-z0-9_]+)/g,
      )) {
        const rawKind = m[1];
        const symName = m[2];
        if (!rawKind || !symName) continue;
        symbols.push(symName);
        if (!isTest && exportedSymbols.length < 24) {
          exportedSymbols.push({
            name: symName,
            kind: rawKind === "interface" || rawKind === "enum" ? "type" : "class",
            file: rel,
            line: lineOf(text, m.index ?? 0),
          });
        }
      }

      ast.files.push({
        file: rel,
        unit: unitName,
        language: "csharp",
        layer: rawLayer,
        canonicalLayer,
        domainArea: null,
        layerSource: "path_convention",
        domainSource: "none",
        isTest,
        isBarrel: false,
        lines: text.split("\n").length,
        exportsCount: symbols.length,
        exportedSymbols,
        capabilities: detectCapabilities(text),
      });

      if (ns && !isTest) {
        const list = nsToFiles.get(ns) ?? [];
        list.push({ rel, symbols });
        nsToFiles.set(ns, list);
      }

      parsedFiles.push({ rel, text, unit, unitName, unitId, ns, rawLayer, canonicalLayer, isTest, symbols });
    }

    const parsedByRel = new Map(parsedFiles.map((p) => [p.rel, p]));
    const layerCounts = new Map<
      string,
      { projName: string; projId: string; layer: string; canonicalLayer: CanonicalLayer; count: number; sampleFile: string }
    >();
    const nonAnalyzerTargets = csUnits.filter((u) => u.kind !== "analyzer").map((u) => u.id);

    for (const item of parsedFiles) {
      const { rel, text, unitName, unitId, rawLayer, canonicalLayer, isTest } = item;

      if (!isTest) {
        const key = `${unitName}::${rawLayer}`;
        const cur = layerCounts.get(key);
        if (cur) cur.count += 1;
        else layerCounts.set(key, { projName: unitName, projId: unitId, layer: rawLayer, canonicalLayer, count: 1, sampleFile: rel });
      }

      const identTokens = new Set<string>(text.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? []);

      for (const m of text.matchAll(/^\s*(?:global\s+)?using\s+(?:static\s+)?([A-Za-z0-9_.]+)\s*;/gm)) {
        const targetNs = m[1];
        if (!targetNs) continue;
        const ln = lineOf(text, m.index ?? 0);
        const targetEntries = nsToFiles.get(targetNs);
        if (targetEntries && targetEntries.length > 0) {
          const matched = targetEntries.filter((te) => {
            if (te.rel === rel) return false;
            return te.symbols.some((sym) => identTokens.has(sym));
          });
          const resolved = matched.length > 0 ? matched : targetEntries.filter((te) => te.rel !== rel);
          for (const te of resolved) {
            const targetItem = parsedByRel.get(te.rel);
            ast.fileImports.push({
              fromFile: rel,
              toFile: te.rel,
              fromUnit: unitName,
              toUnit: targetItem?.unitName ?? unitName,
              fromLayer: rawLayer,
              toLayer: targetItem?.rawLayer ?? "domain",
              fromCanonicalLayer: canonicalLayer,
              toCanonicalLayer: targetItem?.canonicalLayer ?? "domain",
              fromDomain: null,
              toDomain: null,
              line: ln,
              typeOnly: false,
            });
          }
        } else {
          ast.pkgImports.push({
            fromFile: rel,
            unit: unitName,
            layer: rawLayer,
            canonicalLayer,
            pkg: targetNs,
            vendorCategory: classifyVendorPackage(targetNs),
            line: ln,
            typeOnly: false,
          });
        }
      }

      if (canonicalLayer === "analyzer" || /\[DiagnosticAnalyzer/.test(text)) {
        const idMatches = Array.from(text.matchAll(/DiagnosticId\s*=\s*"([A-Z0-9_]+)"/g));
        const titleMatch = text.match(/Title\s*=\s*"([^"]+)"/);
        const msgMatch = text.match(/MessageFormat\s*=\s*"([^"]+)"/);
        const descMatches = Array.from(
          text.matchAll(/new\s+DiagnosticDescriptor\s*\(\s*(?:DiagnosticId|"([A-Z0-9_]+)")\s*,\s*(?:Title|"([^"]+)")\s*,\s*(?:MessageFormat|"([^"]+)")/g),
        );
        const seenDiag = new Set<string>();
        const diagPairs: Array<{ id: string; title: string; msg: string; ln: number }> = [];
        for (const dm of idMatches) {
          const diagId = dm[1];
          if (!diagId || seenDiag.has(diagId)) continue;
          seenDiag.add(diagId);
          diagPairs.push({
            id: diagId,
            title: titleMatch?.[1] ?? diagId,
            msg: msgMatch?.[1] ?? `Roslyn diagnostic ${diagId}`,
            ln: lineOf(text, dm.index ?? 0),
          });
        }
        for (const dm of descMatches) {
          const diagId = dm[1];
          if (!diagId || seenDiag.has(diagId)) continue;
          seenDiag.add(diagId);
          diagPairs.push({
            id: diagId,
            title: dm[2] ?? diagId,
            msg: dm[3] ?? `Roslyn diagnostic ${diagId}`,
            ln: lineOf(text, dm.index ?? 0),
          });
        }
        for (const d of diagPairs) {
          const ruleId = `rule:analyzer:${d.id}`;
          rules.push({
            id: ruleId,
            name: d.id,
            category: "lint_ratchet",
            enforcement: "static",
            rung: "R1",
            statement: `${d.id} (${d.title}): ${d.msg}`,
            targets: nonAnalyzerTargets,
            provenance: { file: rel, line: d.ln },
          });
          ast.govRules.push({
            id: ruleId,
            kind: "prohibition",
            scopePrefix: "",
            symbol: d.id,
            text: `${d.title}: ${d.msg}`,
            rationale: `Enforced by Roslyn analyzer ${unitName}`,
            file: rel,
            line: d.ln,
          });
        }
      }

      if (!isTest) {
        for (const m of text.matchAll(/DbSet<([A-Za-z0-9_]+)>\s+([A-Za-z0-9_]+)/g)) {
          const entityName = m[2] ?? m[1];
          if (entityName) {
            ast.declaredEntities.push({
              datastore: "efcore",
              entity: entityName,
              declaredAt: rel,
              authorizedShared: false,
            });
            ast.entityAccesses.push({
              datastore: "efcore",
              entity: entityName,
              file: rel,
              unit: unitName,
              layer: rawLayer,
              canonicalLayer,
              domainArea: null,
              op: "DBSET",
              line: lineOf(text, m.index ?? 0),
              confidence: "observed",
            });
          }
        }

        for (const em of text.matchAll(/(?:GetEnvironmentVariable\s*\(\s*"([A-Z][A-Z0-9_]{2,})"\s*\)|Configuration\s*\[\s*"([A-Za-z0-9_:]+)"\s*\])/g)) {
          const envName = em[1] ?? em[2];
          if (envName) {
            ast.envBindings.push({
              envName,
              sourceKind: "code_read",
              unit: unitName,
              file: rel,
              line: lineOf(text, em.index ?? 0),
              isSecret: /SECRET|TOKEN|KEY|PASSWORD|CONNECTIONSTRING/i.test(envName),
            });
          }
        }

        const hasAuthorizeAttr = /\[Authorize\b/.test(text);
        for (const rm of text.matchAll(/\[Http(Get|Post|Put|Patch|Delete)\s*(?:\(\s*"([^"]*)"\s*\))?\]/gi)) {
          ast.httpEndpoints.push({
            unit: unitName,
            method: (rm[1] ?? "GET").toUpperCase(),
            path: rm[2] ? (rm[2].startsWith("/") ? rm[2] : `/${rm[2]}`) : "/",
            authGuard: hasAuthorizeAttr ? "Authorize" : null,
            source: "ast",
            handlerFile: rel,
            line: lineOf(text, rm.index ?? 0),
            operationId: null,
          });
        }
        for (const rm of text.matchAll(/\.Map(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"/g)) {
          ast.httpEndpoints.push({
            unit: unitName,
            method: (rm[1] ?? "GET").toUpperCase(),
            path: rm[2] ?? "/",
            authGuard: /\.RequireAuthorization\b/.test(text) ? "RequireAuthorization" : null,
            source: "ast",
            handlerFile: rel,
            line: lineOf(text, rm.index ?? 0),
            operationId: null,
          });
        }

        const sealedByBase = new Map<string, string[]>();
        for (const vm of text.matchAll(/sealed\s+record\s+([A-Za-z0-9_]+)(?:\([^)]*\))?\s*:\s*([A-Za-z0-9_]+)\b/g)) {
          const variant = vm[1];
          const base = vm[2];
          if (variant && base) {
            const list = sealedByBase.get(base) ?? [];
            list.push(variant);
            sealedByBase.set(base, list);
          }
        }
        const transitionsByBase = new Map<string, Array<{ from: string; event: string; to: string; guard?: string }>>();
        for (const tm of text.matchAll(
          /\(\s*([A-Za-z0-9_]+)\.(\w+)(?:\s+\w+)?\s*,\s*\w+\.(\w+)(?:\s+\w+)?\s*\)(?:\s+when\s+([^=]+?))?\s*=>[\s\S]{0,180}?(?:Accepted\(\s*)?new\s+\1\.(\w+)/g,
        )) {
          if (tm[1] && tm[2] && tm[3] && tm[5]) {
            const list = transitionsByBase.get(tm[1]) ?? [];
            list.push({ from: tm[2], event: tm[3], to: tm[5], guard: tm[4]?.trim() || undefined });
            transitionsByBase.set(tm[1], list);
          }
        }

        for (const m of text.matchAll(/public\s+abstract\s+record\s+([A-Za-z0-9_]+)/g)) {
          const baseName = m[1];
          if (!baseName) continue;
          const variants = sealedByBase.get(baseName) ?? [];

          if (variants.length >= 2 && /(?:State|Status|Phase|Stage)$/i.test(baseName)) {
            const transitions = transitionsByBase.get(baseName) ?? [];
            const sortedStates = Array.from(new Set(variants)).sort();
            const ln = lineOf(text, m.index ?? 0);
            if (transitions.length > 0) {
              stateMachines.push({
                id: `arch:sm:csharp:${unitName}:${baseName}`,
                name: baseName,
                language: "csharp",
                unit: unitName,
                evidence: "declared",
                states: sortedStates,
                transitions,
                provenance: { file: rel, line: ln },
              });
            }
            ast.stateEnums.push({
              file: rel,
              unit: unitName,
              language: "csharp",
              name: baseName,
              valuesSignature: sortedStates.join("|"),
              values: sortedStates,
              line: ln,
              hasTransitions: transitions.length > 0,
            });
          }
        }

        for (const m of text.matchAll(/class\s+([A-Za-z0-9_]+)\s*:\s*(?:BackgroundService|IHostedService)/g)) {
          const cls = m[1];
          if (cls) {
            loops.push({
              id: `arch:loop:csharp:${unitName}:${cls}`,
              name: cls,
              kind: "background_service",
              schedule: null,
              unit: unitName,
              provenance: { file: rel, line: lineOf(text, m.index ?? 0) },
            });
          }
        }
      }

      if (isTest && /Architecture.*Tests\.cs$/i.test(rel)) {
        const forbiddenMatches = Array.from(text.matchAll(/"([A-Za-z0-9_.]+\.?)"/g))
          .map((m) => m[1] ?? "")
          .filter((s) => /^(?:Microsoft\.|System\.Net|Npgsql|Azure\.|xunit|FsCheck|EntityFramework)/i.test(s));
        if (forbiddenMatches.length > 0) {
          const ruleId = "rule:boundary:csharp-arch-dag";
          const uniqueForbidden = Array.from(new Set(forbiddenMatches)).sort();
          const domainTargets = csUnits.filter((u) => u.kind === "package" || u.kind === "app").map((u) => u.id);
          nodes.push({
            id: ruleId,
            domain: "rules",
            kind: "boundary_policy",
            role: "rule",
            label: "C# Architecture DAG Test",
            group: "boundary",
            provenance: { file: rel, line: 1 },
            tags: ["R1", "R2", "csharp", "boundary"],
            meta: { forbiddenPrefixes: uniqueForbidden },
          });
          rules.push({
            id: ruleId,
            name: "csharp-architecture-dag",
            category: "boundary",
            enforcement: "executed",
            rung: "R2",
            statement: `Domain assembly forbids references to: ${uniqueForbidden.join(", ")}`,
            targets: domainTargets,
            provenance: { file: rel, line: 1 },
          });
          ast.govRules.push({
            id: ruleId,
            kind: "prohibition",
            scopePrefix: "",
            symbol: "AssemblyDependencyDAG",
            text: `Domain assembly forbids: ${uniqueForbidden.join(", ")}`,
            rationale: `Verified by ${rel}`,
            file: rel,
            line: 1,
          });
        }
      }
    }

    emitCsharpGraph({ ctx, csUnits, validUnitIds, ast, layerCounts, nodes, edges, rules });

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
