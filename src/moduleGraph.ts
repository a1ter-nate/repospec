import path from "node:path";
import { classifyOusterhoutDepth, inferModuleRole, isExcludedCodePath } from "./extractors/moduleFacts.ts";
import { layoutFixedLanes, type RawDiagramEdge, type RawDiagramNode } from "./layout.ts";
import type {
  AstFileFact,
  AstIndexData,
  DiagramLayout,
  EdgeEvidenceItem,
  ModuleCard,
  UnitDescriptor,
} from "./schema.ts";
import {
  buildLanesForLevels,
  computeTopologicalLevels,
  peelUnitModulePaths,
  summarizeModuleMetadata,
} from "./internal/topoLevels.ts";

function stripExt(fileName: string): string {
  return fileName.replace(/\.(?:tsx?|mts|cts|jsx?|mjs|cjs|rs|py|cs)$/, "");
}

function formatModuleSublabel(card: ModuleCard): string {
  const parts: string[] = [];
  if (card.kind === "directory") parts.push(`${card.fileCount} files`);
  parts.push(`${card.lines}L`);
  const ioCaps = card.capabilities.filter((c) => c !== "PURE").slice(0, 2);
  if (ioCaps.length > 0) parts.push(ioCaps.join("+"));
  else if (card.depth === "contract") parts.push("contract");
  else parts.push("PURE");
  if (card.hasSubsystemDiagram || (card.kind === "directory" && card.fileCount >= 2)) parts.push("⊞");
  return parts.join(" · ");
}

function buildSubsystemDiagram(params: {
  unit: UnitDescriptor;
  parentCard: ModuleCard;
  parentDiagramId: string;
  memberEntries: Array<{ fact: AstFileFact; innerRel: string }>;
  importByFrom: Map<string, Array<{ toFile: string; line: number }>>;
}): DiagramLayout | null {
  const { unit, parentCard, parentDiagramId, memberEntries, importByFrom } = params;
  if (memberEntries.length < 3) return null;

  const grouped = new Map<string, { name: string; kind: "file" | "directory"; files: AstFileFact[]; relPath: string }>();
  const fileToSubId = new Map<string, string>();

  for (const entry of memberEntries) {
    const parts = entry.innerRel.split("/");
    const isSubDir = parts.length >= 2 && Boolean(parts[0]);
    const name = isSubDir ? (parts[0] ?? "mod") : stripExt(parts[0] ?? "file");
    const subId = `sub:${unit.slug}:${parentCard.name}:${name}`;
    fileToSubId.set(entry.fact.file, subId);
    const cur = grouped.get(subId);
    if (cur) {
      cur.files.push(entry.fact);
    } else {
      grouped.set(subId, {
        name,
        kind: isSubDir ? "directory" : "file",
        files: [entry.fact],
        relPath: isSubDir ? path.posix.dirname(entry.fact.file) : entry.fact.file,
      });
    }
  }

  if (grouped.size < 2) return null;

  const keptGroups = Array.from(grouped.entries())
    .sort((a, b) => {
      const linesA = a[1].files.reduce((sum, f) => sum + f.lines, 0);
      const linesB = b[1].files.reduce((sum, f) => sum + f.lines, 0);
      return linesB - linesA || a[0].localeCompare(b[0]);
    })
    .slice(0, 24);
  const keptIds = new Set(keptGroups.map(([id]) => id));

  const edgeEvidence = new Map<string, EdgeEvidenceItem[]>();
  for (const entry of memberEntries) {
    const fromSub = fileToSubId.get(entry.fact.file);
    if (!fromSub || !keptIds.has(fromSub)) continue;
    for (const imp of importByFrom.get(entry.fact.file) ?? []) {
      const toSub = fileToSubId.get(imp.toFile);
      if (!toSub || toSub === fromSub || !keptIds.has(toSub)) continue;
      const key = `${fromSub}>${toSub}`;
      const list = edgeEvidence.get(key) ?? [];
      list.push({ file: entry.fact.file, line: imp.line, detail: `imports ${path.posix.basename(imp.toFile)}` });
      edgeEvidence.set(key, list);
    }
  }

  if (edgeEvidence.size === 0) return null;

  const subEdgeList = Array.from(edgeEvidence.keys())
    .sort()
    .map((k) => {
      const [from, to] = k.split(">");
      return { from: from ?? "", to: to ?? "" };
    });

  const topo = computeTopologicalLevels(Array.from(keptIds), subEdgeList);
  const deg = new Map<string, number>();
  for (const e of subEdgeList) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }

  let maxLevel = 0;
  let hasStandalone = false;
  for (const id of keptIds) {
    if ((deg.get(id) ?? 0) === 0) hasStandalone = true;
    else maxLevel = Math.max(maxLevel, topo.levels.get(id) ?? 0);
  }

  const { laneOrder, laneIdFor } = buildLanesForLevels(maxLevel, hasStandalone);
  const rawNodes: RawDiagramNode[] = keptGroups.map(([subId, grp]) => {
    const lines = grp.files.reduce((sum, f) => sum + f.lines, 0);
    const { capabilities: caps } = summarizeModuleMetadata(grp.files);
    const ioCaps = caps.filter((c) => c !== "PURE").slice(0, 2);
    const standalone = (deg.get(subId) ?? 0) === 0;
    const lvl = topo.levels.get(subId) ?? 0;
    const inTangle = topo.inTangle.has(subId);
    return {
      id: subId,
      label: grp.kind === "directory" ? `${grp.name}/` : grp.name,
      sublabel: `${lines}L · ${ioCaps.length > 0 ? ioCaps.join("+") : "PURE"}`,
      group: parentCard.name,
      lane: laneIdFor(lvl, standalone),
      layerRank: lvl,
      kind: "module",
      role: "module",
      domain: "arch",
      shape: "box",
      ambientBadges: inTangle ? ["cycle"] : undefined,
      provenance: { file: grp.files[0]?.file ?? grp.relPath, line: 1 },
    };
  });

  const rawEdges: RawDiagramEdge[] = Array.from(edgeEvidence.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, ev]) => {
      const [from, to] = key.split(">");
      const fromTangle = topo.inTangle.get(from ?? "");
      const toTangle = topo.inTangle.get(to ?? "");
      const isTangleEdge = Boolean(fromTangle && fromTangle === toTangle);
      return {
        from: from ?? "",
        to: to ?? "",
        kind: "imports_layer",
        label: ev.length > 1 ? String(ev.length) : undefined,
        weight: ev.length,
        violation: isTangleEdge,
        confidence: "observed",
        evidence: ev.slice(0, 10),
      };
    });

  return layoutFixedLanes(
    `subsystem:${unit.slug}:${parentCard.name}`,
    `${unit.slug} › ${parentCard.name}/ — Internal Modules`,
    `Levelized internal structure of ${parentCard.name}/ (${memberEntries.length} files · ${rawEdges.length} import links).`,
    "subsystem",
    laneOrder,
    rawNodes,
    rawEdges,
    { ownerId: unit.id, parentDiagramId },
  );
}

export function buildModuleArchitecture(params: {
  units: UnitDescriptor[];
  ast: AstIndexData;
}): { modules: ModuleCard[]; diagrams: DiagramLayout[] } {
  const { units, ast } = params;
  const prodFiles = ast.files.filter(
    (f) => !f.isTest && f.canonicalLayer !== "ops_script" && !isExcludedCodePath(f.file),
  );
  if (prodFiles.length === 0) return { modules: [], diagrams: [] };

  const filesByUnit = new Map<string, AstFileFact[]>();
  for (const f of prodFiles) {
    const list = filesByUnit.get(f.unit) ?? [];
    list.push(f);
    filesByUnit.set(f.unit, list);
  }

  const importByFrom = new Map<string, Array<{ toFile: string; line: number }>>();
  for (const imp of ast.fileImports) {
    const list = importByFrom.get(imp.fromFile) ?? [];
    list.push({ toFile: imp.toFile, line: imp.line });
    importByFrom.set(imp.fromFile, list);
  }

  const allModules: ModuleCard[] = [];
  const moduleDiagrams: DiagramLayout[] = [];
  const subsystemCandidates: Array<{ fileCount: number; diagram: DiagramLayout }> = [];

  const nonTestUnits = units
    .filter((u) => u.kind !== "test_package" && !u.external)
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const unit of nonTestUnits) {
    const unitFiles = filesByUnit.get(unit.name) ?? [];
    if (unitFiles.length < 2) continue;

    const peeled = peelUnitModulePaths(unitFiles, unit.dir, unit.slug);

    const modGroups = new Map<
      string,
      {
        name: string;
        kind: "file" | "directory";
        relPath: string;
        files: Array<{ fact: AstFileFact; innerRel: string }>;
      }
    >();
    const fileToModId = new Map<string, string>();

    for (const item of peeled) {
      const parts = item.rel.split("/");
      const isDir = parts.length >= 2 && Boolean(parts[0]);
      const name = isDir ? (parts[0] ?? "mod") : stripExt(parts[0] ?? "index");
      const modId = `mod:${unit.slug}:${name}`;
      fileToModId.set(item.fact.file, modId);
      const innerRel = isDir ? parts.slice(1).join("/") : item.rel;
      const cur = modGroups.get(modId);
      if (cur) {
        cur.files.push({ fact: item.fact, innerRel });
      } else {
        const relPath = isDir
          ? path.posix.dirname(item.fact.file).split("/").slice(0, item.fact.file.split("/").length - parts.length + 1).join("/") || item.fact.file
          : item.fact.file;
        modGroups.set(modId, {
          name,
          kind: isDir ? "directory" : "file",
          relPath,
          files: [{ fact: item.fact, innerRel }],
        });
      }
    }

    if (modGroups.size < 2) continue;

    const modEdgeEvidence = new Map<string, EdgeEvidenceItem[]>();
    for (const item of peeled) {
      const fromMod = fileToModId.get(item.fact.file);
      if (!fromMod) continue;
      for (const imp of importByFrom.get(item.fact.file) ?? []) {
        const toMod = fileToModId.get(imp.toFile);
        if (!toMod || toMod === fromMod) continue;
        const key = `${fromMod}>${toMod}`;
        const list = modEdgeEvidence.get(key) ?? [];
        list.push({ file: item.fact.file, line: imp.line, detail: `imports ${path.posix.basename(imp.toFile)}` });
        modEdgeEvidence.set(key, list);
      }
    }

    const modIds = Array.from(modGroups.keys()).sort();
    const edgePairs = Array.from(modEdgeEvidence.keys())
      .sort()
      .map((k) => {
        const [from, to] = k.split(">");
        return { from: from ?? "", to: to ?? "" };
      });

    const topo = computeTopologicalLevels(modIds, edgePairs);
    const fanInMap = new Map<string, number>();
    const fanOutMap = new Map<string, number>();
    for (const e of edgePairs) {
      fanOutMap.set(e.from, (fanOutMap.get(e.from) ?? 0) + 1);
      fanInMap.set(e.to, (fanInMap.get(e.to) ?? 0) + 1);
    }

    let maxLevel = 0;
    let hasStandalone = false;
    for (const id of modIds) {
      const fi = fanInMap.get(id) ?? 0;
      const fo = fanOutMap.get(id) ?? 0;
      if (fi === 0 && fo === 0) hasStandalone = true;
      else maxLevel = Math.max(maxLevel, topo.levels.get(id) ?? 0);
    }

    const parentDiagramId = `modules:${unit.slug}`;
    const unitCards: ModuleCard[] = [];

    for (const modId of modIds) {
      const grp = modGroups.get(modId);
      if (!grp) continue;
      const facts = grp.files.map((x) => x.fact);
      const lines = facts.reduce((sum, f) => sum + f.lines, 0);
      const exportCount = facts.reduce((sum, f) => sum + f.exportsCount, 0);
      const { capabilities, topExports } = summarizeModuleMetadata(facts);
      const allTypeExports =
        topExports.length > 0 && topExports.every((s) => s.kind === "type" || s.kind === "const");
      const fanIn = fanInMap.get(modId) ?? 0;
      const fanOut = fanOutMap.get(modId) ?? 0;
      const level = topo.levels.get(modId) ?? 0;
      const tangleId = topo.inTangle.get(modId) ?? null;
      const depth = classifyOusterhoutDepth(lines, exportCount, allTypeExports);
      const role = inferModuleRole({
        name: grp.name,
        fanIn,
        fanOut,
        level,
        maxLevel,
        capabilities,
        allTypeExports,
      });
      const langCounts = new Map<string, number>();
      for (const f of facts) langCounts.set(f.language, (langCounts.get(f.language) ?? 0) + 1);
      const primaryLang =
        Array.from(langCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
        unit.ecosystem;

      const card: ModuleCard = {
        id: modId,
        unitId: unit.id,
        unitName: unit.name,
        unitSlug: unit.slug,
        name: grp.name,
        kind: grp.kind,
        relPath: grp.relPath,
        language: primaryLang,
        level,
        role,
        depth,
        fileCount: facts.length,
        lines,
        exportCount,
        fanIn,
        fanOut,
        inTangle: tangleId !== null,
        tangleId,
        hasSubsystemDiagram: false,
        capabilities,
        topExports,
        files: [...facts]
          .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file))
          .slice(0, 40)
          .map((f) => ({
            file: f.file,
            lines: f.lines,
            exports: f.exportsCount,
            capabilities: f.capabilities ?? ["PURE"],
          })),
      };

      if (grp.kind === "directory" && facts.length >= 3) {
        const subDiag = buildSubsystemDiagram({
          unit,
          parentCard: card,
          parentDiagramId,
          memberEntries: grp.files,
          importByFrom,
        });
        if (subDiag) {
          card.hasSubsystemDiagram = true;
          subsystemCandidates.push({ fileCount: facts.length, diagram: subDiag });
        }
      }

      unitCards.push(card);
      allModules.push(card);
    }

    const { laneOrder, laneIdFor } = buildLanesForLevels(maxLevel, hasStandalone);
    const rankedCards = [...unitCards]
      .sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut) || b.lines - a.lines || a.id.localeCompare(b.id))
      .slice(0, 32);
    const keptModIds = new Set(rankedCards.map((c) => c.id));
    const foldedCount = Math.max(0, unitCards.length - rankedCards.length);

    const rawNodes: RawDiagramNode[] = rankedCards.map((card) => {
      const standalone = card.fanIn === 0 && card.fanOut === 0;
      const badges: string[] = [];
      if (card.inTangle) badges.push("tangle");
      return {
        id: card.id,
        label: card.kind === "directory" ? `${card.name}/` : card.name,
        sublabel: formatModuleSublabel(card),
        group: card.role,
        lane: laneIdFor(card.level, standalone),
        layerRank: card.level,
        kind: "module",
        role: "module",
        domain: "arch",
        shape: card.role === "foundation" ? "hex" : card.role === "entry" ? "pill" : "box",
        expandable: card.kind === "file" || card.hasSubsystemDiagram || (card.kind === "directory" && card.fileCount >= 2) ? true : undefined,
        ambientBadges: badges.length > 0 ? badges : undefined,
        provenance: { file: card.files[0]?.file ?? card.relPath, line: 1 },
      };
    });

    const rawEdges: RawDiagramEdge[] = Array.from(modEdgeEvidence.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([key]) => {
        const [from, to] = key.split(">");
        return Boolean(from && to && keptModIds.has(from) && keptModIds.has(to));
      })
      .map(([key, ev]) => {
        const [from, to] = key.split(">");
        const ft = topo.inTangle.get(from ?? "");
        const tt = topo.inTangle.get(to ?? "");
        const isTangleEdge = Boolean(ft && ft === tt);
        return {
          from: from ?? "",
          to: to ?? "",
          kind: "imports_layer",
          label: ev.length > 1 ? String(ev.length) : undefined,
          weight: ev.length,
          violation: isTangleEdge,
          confidence: "observed",
          evidence: ev.slice(0, 12),
        };
      });

    const tangleCount = new Set(unitCards.map((c) => c.tangleId).filter(Boolean)).size;
    const subtitle =
      tangleCount > 0
        ? `Levelized from Entry (L0) → Foundation · ${unitCards.length} modules · ${rawEdges.length} links · ${tangleCount} cyclic tangle${tangleCount === 1 ? "" : "s"} highlighted in red.`
        : `Levelized from Entry (L0) → Foundation · ${unitCards.length} modules · ${rawEdges.length} links · Clean acyclic DAG. Click any module to inspect its API & capabilities.`;

    moduleDiagrams.push(
      layoutFixedLanes(
        parentDiagramId,
        `${unit.slug} — Module Architecture`,
        subtitle,
        "modules",
        laneOrder,
        rawNodes,
        rawEdges,
        { ownerId: unit.id, foldedCount },
      ),
    );
  }

  const keptSubsystems = subsystemCandidates
    .sort((a, b) => b.fileCount - a.fileCount || a.diagram.id.localeCompare(b.diagram.id))
    .slice(0, 12)
    .map((x) => x.diagram);

  const keptSubIds = new Set(keptSubsystems.map((d) => d.id));
  for (const m of allModules) {
    if (m.hasSubsystemDiagram && !keptSubIds.has(`subsystem:${m.unitSlug}:${m.name}`)) {
      m.hasSubsystemDiagram = false;
    }
  }

  allModules.sort((a, b) => a.unitSlug.localeCompare(b.unitSlug) || a.level - b.level || a.name.localeCompare(b.name));
  moduleDiagrams.sort((a, b) => b.nodes.length - a.nodes.length || a.id.localeCompare(b.id));

  return {
    modules: allModules,
    diagrams: [...moduleDiagrams, ...keptSubsystems],
  };
}
