import fs from "node:fs";
import path from "node:path";
import type { AstIndexData, UnitDescriptor } from "../schema.ts";
import { extractGitChurnMap } from "../extractors/gitMetrics.ts";
import { isExcludedCodePath } from "../extractors/moduleFacts.ts";
import { resolveCoveragePctForFile, type RealCoverageReport } from "../internal/coverage.ts";
import { extractFileCallGraph, packSourceArchiveBase64, type FileSymbolTuple } from "./fileSymbols.ts";

export interface DrilldownFile {
  p: string;
  u: string;
  d: string;
  l: number;
  e: number;
  c: string[];
  s: Array<[string, string, number]>;
  x: string[];
  t: string[];
  v: string[];
  tc?: 0 | 1;
  fc?: number;
  ch?: number;
  m?: FileSymbolTuple[];
  k?: Array<[number, number, number]>;
  o?: Array<[number, string, number]>;
}

export interface DrilldownIndex {
  files: DrilldownFile[];
  edges: Array<[number, number, number]>;
  sourcesGzipBase64?: string;
  extraSources?: Record<string, string>;
}

export function buildDrilldownIndex(
  units: UnitDescriptor[],
  ast: AstIndexData,
  repoRoot?: string,
  realCoverage?: RealCoverageReport | null,
  extraFiles?: readonly string[],
): DrilldownIndex {
  const unitByName = new Map<string, UnitDescriptor>();
  for (const u of units) unitByName.set(u.name, u);

  const extByFile = new Map<string, Set<string>>();
  for (const h of ast.externalHosts) {
    const set = extByFile.get(h.file) ?? new Set<string>();
    set.add(h.serviceLabel);
    extByFile.set(h.file, set);
  }
  for (const p of ast.pkgImports) {
    if (!p.vendorCategory || p.typeOnly) continue;
    const set = extByFile.get(p.fromFile) ?? new Set<string>();
    set.add(p.pkg);
    extByFile.set(p.fromFile, set);
  }

  const entitiesByFile = new Map<string, Set<string>>();
  for (const ea of ast.entityAccesses) {
    const set = entitiesByFile.get(ea.file) ?? new Set<string>();
    set.add(`${ea.datastore}:${ea.entity}`);
    entitiesByFile.set(ea.file, set);
  }

  const envByFile = new Map<string, Set<string>>();
  for (const ev of ast.envBindings) {
    const set = envByFile.get(ev.file) ?? new Set<string>();
    set.add(ev.envName);
    envByFile.set(ev.file, set);
  }

  const testFiles = new Set(ast.files.filter((f) => f.isTest).map((f) => f.file));
  const testedProdFiles = new Set<string>();
  for (const imp of ast.fileImports) {
    if (testFiles.has(imp.fromFile)) testedProdFiles.add(imp.toFile);
  }
  const churnByFile = repoRoot ? extractGitChurnMap(repoRoot) : new Map<string, number>();

  const prodFiles = ast.files
    .filter((f) => !f.isTest && f.canonicalLayer !== "ops_script" && !isExcludedCodePath(f.file))
    .sort((a, b) => a.file.localeCompare(b.file));

  const files: DrilldownFile[] = [];
  const idxByPath = new Map<string, number>();
  const sourceTexts: string[] = [];

  for (const f of prodFiles) {
    const u = unitByName.get(f.unit);
    const unitSlug = u?.slug ?? f.unit.replace(/^@[^/]+\//, "");
    const unitDir = u && u.dir !== "." ? u.dir : "";
    const symbols: Array<[string, string, number]> = (f.exportedSymbols ?? [])
      .slice(0, 20)
      .map((s) => [s.name, s.kind, s.line]);

    let callGraph: ReturnType<typeof extractFileCallGraph> | null = null;
    let packedText = "";
    if (repoRoot) {
      const absPath = path.join(repoRoot, f.file);
      if (fs.existsSync(absPath)) {
        const raw = fs.readFileSync(absPath, "utf8");
        callGraph = extractFileCallGraph(f.file, raw);
        const lines = raw.split("\n");
        packedText = lines.length > 1200 ? `${lines.slice(0, 1200).join("\n")}\n// ... truncated (${lines.length} lines total)` : raw;
      }
    }
    sourceTexts.push(packedText);

    idxByPath.set(f.file, files.length);
    files.push({
      p: f.file,
      u: unitSlug,
      d: unitDir,
      l: f.lines,
      e: f.exportsCount,
      c: f.capabilities ?? ["PURE"],
      s: symbols,
      x: Array.from(extByFile.get(f.file) ?? []).sort().slice(0, 8),
      t: Array.from(entitiesByFile.get(f.file) ?? []).sort().slice(0, 10),
      v: Array.from(envByFile.get(f.file) ?? []).sort().slice(0, 10),
      tc: testedProdFiles.has(f.file) ? 1 : 0,
      fc: resolveCoveragePctForFile(f.file, realCoverage),
      ch: churnByFile.get(f.file) ?? 0,
      m: callGraph && callGraph.m.length > 0 ? callGraph.m : undefined,
      k: callGraph && callGraph.m.length > 0 ? callGraph.k : undefined,
      o: callGraph && callGraph.m.length > 0 ? callGraph.o : undefined,
    });
  }

  const seenEdge = new Set<string>();
  const edges: Array<[number, number, number]> = [];
  const sortedImports = [...ast.fileImports].sort(
    (a, b) => a.fromFile.localeCompare(b.fromFile) || a.toFile.localeCompare(b.toFile) || a.line - b.line,
  );
  for (const imp of sortedImports) {
    const fromIdx = idxByPath.get(imp.fromFile);
    const toIdx = idxByPath.get(imp.toFile);
    if (fromIdx === undefined || toIdx === undefined || fromIdx === toIdx) continue;
    const key = `${fromIdx}>${toIdx}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    edges.push([fromIdx, toIdx, imp.line]);
  }

  let extraSources: Record<string, string> | undefined;
  if (repoRoot && extraFiles && extraFiles.length > 0) {
    const extras: Record<string, string> = {};
    let count = 0;
    for (const rel of extraFiles) {
      if (!rel || idxByPath.has(rel) || rel in extras || count >= 60) continue;
      const absPath = path.join(repoRoot, rel);
      if (!fs.existsSync(absPath)) continue;
      try {
        const raw = fs.readFileSync(absPath, "utf8");
        const lines = raw.split("\n");
        extras[rel] = lines.length > 600 ? `${lines.slice(0, 600).join("\n")}\n// ... truncated (${lines.length} lines total)` : raw;
        count += 1;
      } catch {
        continue;
      }
    }
    if (count > 0) extraSources = extras;
  }

  const sourcesGzipBase64 = repoRoot && sourceTexts.length > 0 ? packSourceArchiveBase64(sourceTexts) : undefined;
  return { files, edges, sourcesGzipBase64, extraSources };
}
