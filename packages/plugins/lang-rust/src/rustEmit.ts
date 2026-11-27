import type {
  AstDeclaredEntityFact,
  AstIndexData,
  CanonicalLayer,
  DbForeignKeyFact,
  LoopRecord,
  RepoContext,
  SpecEdge,
  SpecNode,
  StateMachineRecord,
  UnitDescriptor,
} from "@repospec/plugin";
import { resolveLayerSemantics } from "@repospec/plugin";
import { RUST_AST_HELPERS } from "./rustHelpers.ts";

const { extractBraceBlock, lineOf } = RUST_AST_HELPERS;

export function extractRustMachinesAndLoops(params: {
  prodText: string;
  rel: string;
  unitName: string;
  modName: string;
  ast: AstIndexData;
  stateMachines: StateMachineRecord[];
  loops: LoopRecord[];
}): void {
  const { prodText, rel, unitName, modName, ast, stateMachines, loops } = params;
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

export function emitRustGraph(params: {
  ctx: RepoContext;
  rustUnits: UnitDescriptor[];
  validUnitIds: Set<string>;
  declaredTables: Set<string>;
  declaredEntities: AstDeclaredEntityFact[];
  dbForeignKeys: DbForeignKeyFact[];
  crateTableRefs: Map<string, number>;
  crateLayerCounts: Map<
    string,
    { crateName: string; crateId: string; layer: string; canonicalLayer: CanonicalLayer; count: number; sampleFile: string }
  >;
  crateRouteCounts: Map<string, number>;
  layerEdgeEvidence: Map<string, Array<{ file: string; line: number; detail: string }>>;
  nodes: SpecNode[];
  edges: SpecEdge[];
}): void {
  const {
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
  } = params;
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
        if (!validUnitIds.has(crateId)) continue;
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
      if (!validUnitIds.has(info.crateId)) continue;
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

}
