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
import { classifyVendorPackage, createEmptyAst, detectCapabilities, isExcludedCodePath } from "@repospec/plugin";
import { extractCsharpFileArtifacts } from "./csharpExtractors.ts";
import { classifyCsharpLayer, emitCsharpGraph, lineOf, walkCsFilesInDir } from "./csharpHelpers.ts";
import {
  collectCsharpDeclaredStateTypes,
  resolveCsharpStateMachines,
  type CsharpDeclaredStateType,
} from "./csharpStateAndLoops.ts";

interface ParsedCsFile {
  rel: string;
  text: string;
  unit: UnitDescriptor | null;
  unitName: string;
  unitId: string;
  ns: string | null;
  rawLayer: string;
  canonicalLayer: CanonicalLayer;
  domainArea: string | null;
  isTest: boolean;
  symbols: string[];
}

function readTextSafe(absPath: string): string | null {
  try {
    return fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf8") : null;
  } catch {
    return null;
  }
}

function collectXmlUsingsAndPackages(
  ctx: RepoContext,
  csUnits: readonly UnitDescriptor[],
): {
  unitGlobalUsings: Map<string, Set<string>>;
  unitPackages: Map<string, Array<{ pkg: string; file: string; line: number }>>;
} {
  const unitGlobalUsings = new Map<string, Set<string>>();
  const unitPackages = new Map<string, Array<{ pkg: string; file: string; line: number }>>();
  const addUsing = (unitName: string, ns: string): void => {
    const set = unitGlobalUsings.get(unitName) ?? new Set<string>();
    set.add(ns);
    unitGlobalUsings.set(unitName, set);
  };
  const addPkg = (unitName: string, pkg: string, file: string, line: number): void => {
    const list = unitPackages.get(unitName) ?? [];
    list.push({ pkg, file, line });
    unitPackages.set(unitName, list);
  };

  const rootProps = readTextSafe(path.join(ctx.rootDir, "Directory.Build.props"));
  const rootUsings: string[] = [];
  if (rootProps) {
    for (const m of rootProps.matchAll(/<Using\s+[^>]*Include="([A-Za-z0-9_.]+)"/gi)) {
      if (m[1]) rootUsings.push(m[1]);
    }
  }

  for (const u of csUnits) {
    for (const ns of rootUsings) addUsing(u.name, ns);
    const csprojText = readTextSafe(path.resolve(ctx.rootDir, u.manifestFile));
    if (!csprojText) continue;
    for (const m of csprojText.matchAll(/<Using\s+[^>]*Include="([A-Za-z0-9_.]+)"/gi)) {
      if (m[1]) addUsing(u.name, m[1]);
    }
    for (const m of csprojText.matchAll(/<PackageReference\s+[^>]*Include="([A-Za-z0-9_.-]+)"/gi)) {
      if (m[1]) addPkg(u.name, m[1], u.manifestFile, lineOf(csprojText, m.index ?? 0));
    }
  }

  return { unitGlobalUsings, unitPackages };
}

function extractCsharpFileSymbols(
  rel: string,
  text: string,
  isTest: boolean,
): { symbols: string[]; exportedSymbols: ExportedSymbol[] } {
  const exportedSymbols: ExportedSymbol[] = [];
  const symbols: string[] = [];
  const seen = new Set<string>();
  const declRe =
    /(?:^|\n)\s*(?:(?:public|internal|private|protected|file)\s+)?(?:(?:static|sealed|abstract|partial|readonly|ref|unsafe|new)\s+)*(?:(record\s+(?:class|struct)|class|record|interface|enum|struct)\s+([A-Za-z_][A-Za-z0-9_]*)|delegate\s+[^\n;(]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\()/g;
  for (const m of text.matchAll(declRe)) {
    const rawKind = m[1] ?? "delegate";
    const symName = m[2] ?? m[3];
    if (!symName || seen.has(symName)) continue;
    seen.add(symName);
    symbols.push(symName);
    if (!isTest && exportedSymbols.length < 24) {
      exportedSymbols.push({
        name: symName,
        kind: rawKind === "interface" || rawKind === "enum" || rawKind === "delegate" ? "type" : "class",
        file: rel,
        line: lineOf(text, m.index ?? 0),
      });
    }
  }
  return { symbols, exportedSymbols };
}

function extractRoslynAnalyzerRules(
  item: ParsedCsFile,
  nonAnalyzerTargets: string[],
  rules: SpecRule[],
  ast: ReturnType<typeof createEmptyAst>,
): void {
  const { rel, text, unitName } = item;
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

export const csharpAstExtractor: ExtractorPlugin = {
  id: "arch.csharp-ast.v4",
  domain: "arch",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const csUnits = ctx.units.filter((u) => u.ecosystem === "csharp");
    const validUnitIds = new Set(ctx.units.map((u) => u.id));
    const inTreeCs = ctx.allFiles.filter((f) => f.endsWith(".cs") && (csUnits.length > 0 || !isExcludedCodePath(f)));
    const externalCs: string[] = [];
    for (const u of csUnits) {
      if (u.external) externalCs.push(...walkCsFilesInDir(u.absDir, ctx.rootDir));
    }
    const allCsFiles = Array.from(new Set([...inTreeCs, ...externalCs]))
      .filter((f) =>
        csUnits.length > 0
          ? !/^(?:templates|fixtures|corpus|reports)\//i.test(f) || csUnits.some((u) => f.startsWith(`${u.dir}/`))
          : !isExcludedCodePath(f),
      )
      .sort();
    if (allCsFiles.length === 0) return { nodes: [], edges: [], rules: [] };

    const sortedUnits = [...csUnits].sort((a, b) => b.dir.length - a.dir.length);
    const ast = createEmptyAst();
    const stateMachines: StateMachineRecord[] = [];
    const loops: LoopRecord[] = [];
    const nodes: SpecNode[] = [];
    const edges: SpecEdge[] = [];
    const rules: SpecRule[] = [];

    const { unitGlobalUsings, unitPackages } = collectXmlUsingsAndPackages(ctx, csUnits);
    for (const [unitName, pkgs] of unitPackages) {
      const unitObj = csUnits.find((u) => u.name === unitName);
      const isTestUnit = unitObj?.kind === "test_package";
      for (const p of pkgs) {
        ast.pkgImports.push({
          fromFile: p.file,
          unit: unitName,
          layer: isTestUnit ? "tests" : "manifest",
          canonicalLayer: isTestUnit ? "tests" : "support",
          pkg: p.pkg,
          vendorCategory: classifyVendorPackage(p.pkg),
          line: p.line,
          typeOnly: false,
        });
      }
    }

    const nsToFiles = new Map<string, Array<{ rel: string; symbols: string[] }>>();
    const symbolToFiles = new Map<string, Array<{ rel: string; ns: string | null }>>();
    const knownDbSets = new Map<string, string>();
    const unitTexts = new Map<string, string[]>();
    const declaredStateTypes: CsharpDeclaredStateType[] = [];
    const parsedFiles: ParsedCsFile[] = [];

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
      const text = readTextSafe(path.resolve(ctx.rootDir, rel));
      if (text === null) continue;
      const unit = resolveCsUnit(rel);
      const unitName = unit?.name ?? ctx.repoName;
      const unitId = unit?.id ?? `arch:app:${ctx.repoName}`;
      const ns = text.match(/^\s*namespace\s+([A-Za-z0-9_.]+)/m)?.[1] ?? null;
      const { rawLayer, canonicalLayer, domainArea } = classifyCsharpLayer(rel, text, unit);
      const isTest = canonicalLayer === "tests";
      const { symbols, exportedSymbols } = extractCsharpFileSymbols(rel, text, isTest);

      for (const gm of text.matchAll(/^\s*global\s+using\s+(?:static\s+)?(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*)?([A-Za-z0-9_.]+)\s*;/gm)) {
        if (gm[1]) {
          const set = unitGlobalUsings.get(unitName) ?? new Set<string>();
          set.add(gm[1]);
          unitGlobalUsings.set(unitName, set);
        }
      }

      if (!isTest) {
        for (const dm of text.matchAll(/DbSet\s*<\s*([A-Za-z0-9_]+)\s*>\s+([A-Za-z0-9_]+)/g)) {
          const prop = dm[2] ?? dm[1];
          if (prop) knownDbSets.set(prop.toLowerCase(), prop);
        }
        const texts = unitTexts.get(unitName) ?? [];
        texts.push(text);
        unitTexts.set(unitName, texts);
        declaredStateTypes.push(...collectCsharpDeclaredStateTypes(rel, text, unitName));
      }

      ast.files.push({
        file: rel,
        unit: unitName,
        language: "csharp",
        layer: rawLayer,
        canonicalLayer,
        domainArea,
        layerSource: "path_convention",
        domainSource: domainArea ? "path_convention" : "none",
        isTest,
        isBarrel: false,
        lines: text.split("\n").length,
        exportsCount: symbols.length,
        exportedSymbols,
        capabilities: detectCapabilities(text),
      });

      if (!isTest) {
        if (ns) {
          const list = nsToFiles.get(ns) ?? [];
          list.push({ rel, symbols });
          nsToFiles.set(ns, list);
        }
        for (const sym of symbols) {
          if (sym.length < 3) continue;
          const sl = symbolToFiles.get(sym) ?? [];
          sl.push({ rel, ns });
          symbolToFiles.set(sym, sl);
        }
      }

      parsedFiles.push({ rel, text, unit, unitName, unitId, ns, rawLayer, canonicalLayer, domainArea, isTest, symbols });
    }

    const parsedByRel = new Map(parsedFiles.map((p) => [p.rel, p]));
    const layerCounts = new Map<
      string,
      { projName: string; projId: string; layer: string; canonicalLayer: CanonicalLayer; count: number; sampleFile: string }
    >();
    const nonAnalyzerTargets = csUnits.filter((u) => u.kind !== "analyzer").map((u) => u.id);

    for (const item of parsedFiles) {
      const { rel, text, unitName, unitId, rawLayer, canonicalLayer, domainArea, isTest } = item;

      if (!isTest) {
        const key = `${unitName}::${rawLayer}`;
        const cur = layerCounts.get(key);
        if (cur) cur.count += 1;
        else layerCounts.set(key, { projName: unitName, projId: unitId, layer: rawLayer, canonicalLayer, count: 1, sampleFile: rel });
      }

      const identTokens = new Set<string>(text.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? []);
      const seenTargets = new Set<string>();
      const pushCsImport = (targetRel: string, ln: number): void => {
        if (targetRel === rel || seenTargets.has(targetRel)) return;
        seenTargets.add(targetRel);
        const targetItem = parsedByRel.get(targetRel);
        ast.fileImports.push({
          fromFile: rel,
          toFile: targetRel,
          fromUnit: unitName,
          toUnit: targetItem?.unitName ?? unitName,
          fromLayer: rawLayer,
          toLayer: targetItem?.rawLayer ?? "domain",
          fromCanonicalLayer: canonicalLayer,
          toCanonicalLayer: targetItem?.canonicalLayer ?? "domain",
          fromDomain: domainArea,
          toDomain: targetItem?.domainArea ?? null,
          line: ln,
          typeOnly: false,
        });
      };

      const resolveNamespaceImport = (targetNs: string, ln: number, recordExternal: boolean): void => {
        const exactEntries = nsToFiles.get(targetNs);
        const prefixEntries =
          exactEntries && exactEntries.length > 0
            ? exactEntries
            : Array.from(nsToFiles.entries())
                .filter(([nsKey]) => nsKey.startsWith(`${targetNs}.`))
                .flatMap(([, entries]) => entries);
        if (prefixEntries.length > 0) {
          const matched = prefixEntries.filter((te) => te.rel !== rel && te.symbols.some((sym) => identTokens.has(sym)));
          const resolved = matched.length > 0 ? matched : recordExternal ? (exactEntries ?? []).filter((te) => te.rel !== rel) : [];
          for (const te of resolved) pushCsImport(te.rel, ln);
          return;
        }
        const lastDot = targetNs.lastIndexOf(".");
        if (lastDot > 0) {
          const parentNs = targetNs.slice(0, lastDot);
          const staticType = targetNs.slice(lastDot + 1);
          const staticHit = (nsToFiles.get(parentNs) ?? []).filter((te) => te.rel !== rel && te.symbols.includes(staticType));
          if (staticHit.length > 0) {
            for (const te of staticHit) pushCsImport(te.rel, ln);
            return;
          }
        }
        if (recordExternal) {
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
      };

      for (const m of text.matchAll(/^\s*(?:global\s+)?using\s+(?:static\s+)?(?:[A-Za-z_][A-Za-z0-9_]*\s*=\s*)?([A-Za-z0-9_.]+)\s*;/gm)) {
        if (m[1]) resolveNamespaceImport(m[1], lineOf(text, m.index ?? 0), true);
      }

      const globalSet = unitGlobalUsings.get(unitName);
      if (globalSet) {
        for (const gNs of globalSet) resolveNamespaceImport(gNs, 1, false);
      }

      if (item.ns) {
        const nsParts = item.ns.split(".");
        for (let depth = nsParts.length; depth >= 1; depth -= 1) {
          const scopeEntries = nsToFiles.get(nsParts.slice(0, depth).join("."));
          if (!scopeEntries) continue;
          for (const te of scopeEntries) {
            if (te.rel === rel || seenTargets.has(te.rel)) continue;
            if (te.symbols.some((sym) => sym.length >= 3 && identTokens.has(sym))) pushCsImport(te.rel, 1);
          }
        }
      }

      for (const qm of text.matchAll(/\b([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)+)\b/g)) {
        const fullRef = qm[1] ?? "";
        const dotIdx = fullRef.lastIndexOf(".");
        if (dotIdx <= 0) continue;
        const symName = fullRef.slice(dotIdx + 1);
        const qualifier = fullRef.slice(0, dotIdx);
        const hits = symbolToFiles.get(symName);
        if (!hits) continue;
        for (const h of hits) {
          if (h.ns && (h.ns === qualifier || h.ns.endsWith(`.${qualifier}`))) {
            pushCsImport(h.rel, lineOf(text, qm.index ?? 0));
          }
        }
      }

      if (canonicalLayer === "analyzer" || /\[DiagnosticAnalyzer/.test(text)) {
        extractRoslynAnalyzerRules(item, nonAnalyzerTargets, rules, ast);
      }

      if (!isTest) {
        extractCsharpFileArtifacts({
          rel,
          text,
          unitName,
          rawLayer,
          canonicalLayer,
          domainArea,
          knownDbSets,
          ast,
          loops,
        });
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

    resolveCsharpStateMachines(declaredStateTypes, unitTexts, ast, stateMachines);
    emitCsharpGraph({ ctx, csUnits, validUnitIds, ast, layerCounts, nodes, edges, rules });

    return { nodes, edges, rules, stateMachines, loops, ast };
  },
};
