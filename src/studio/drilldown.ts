import type { AstIndexData, UnitDescriptor } from "../schema.ts";
import { isExcludedCodePath } from "../extractors/moduleFacts.ts";

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
}

export interface DrilldownIndex {
  files: DrilldownFile[];
  edges: Array<[number, number, number]>;
}

export function buildDrilldownIndex(
  units: UnitDescriptor[],
  ast: AstIndexData,
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

  const prodFiles = ast.files
    .filter((f) => !f.isTest && f.canonicalLayer !== "ops_script" && !isExcludedCodePath(f.file))
    .sort((a, b) => a.file.localeCompare(b.file));

  const files: DrilldownFile[] = [];
  const idxByPath = new Map<string, number>();

  for (const f of prodFiles) {
    const u = unitByName.get(f.unit);
    const unitSlug = u?.slug ?? f.unit.replace(/^@[^/]+\//, "");
    const unitDir = u && u.dir !== "." ? u.dir : "";
    const symbols: Array<[string, string, number]> = (f.exportedSymbols ?? [])
      .slice(0, 20)
      .map((s) => [s.name, s.kind, s.line]);

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

  return { files, edges };
}
