import type {
  AstIndexData,
  EdgeEvidenceItem,
  SpecEdge,
  SpecNode,
} from "../../schema.ts";
import { resolveLayerSemantics } from "../../taxonomy.ts";
import type { DomainConfig } from "./codeAstHelpers.ts";
import type { LayerFileCountEntry } from "./codeAstWalk.ts";

export function emitCodeAstGraph(params: {
  validUnitIds: Set<string>;
  indexesRel: string | undefined;
  domainConfig: DomainConfig;
  ast: AstIndexData;
  layerFileCounts: Map<string, LayerFileCountEntry>;
  domainFileCounts: Map<string, { count: number; sampleFile: string }>;
  layerPairEvidence: Map<string, EdgeEvidenceItem[]>;
  domainPairEvidence: Map<string, EdgeEvidenceItem[]>;
  layerDatastoreEvidence: Map<string, EdgeEvidenceItem[]>;
  unitDatastoreEvidence: Map<string, EdgeEvidenceItem[]>;
  unitExternalEvidence: Map<string, { label: string; category: string; evidence: EdgeEvidenceItem[] }>;
  layerExternalEvidence: Map<string, { label: string; category: string; evidence: EdgeEvidenceItem[] }>;
  nodes: SpecNode[];
  edges: SpecEdge[];
}): void {
  const {
    validUnitIds,
    indexesRel,
    domainConfig,
    ast,
    layerFileCounts,
    domainFileCounts,
    layerPairEvidence,
    domainPairEvidence,
    layerDatastoreEvidence,
    unitDatastoreEvidence,
    unitExternalEvidence,
    layerExternalEvidence,
    nodes,
    edges,
  } = params;
    const validLayerIds = new Set<string>();
    for (const [, info] of Array.from(layerFileCounts.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const lid = `arch:layer:${info.unitSlug}:${info.rawLayer}`;
      const sem = resolveLayerSemantics(info.rawLayer, info.canonicalLayer);
      validLayerIds.add(lid);
      nodes.push({
        id: lid,
        domain: "arch",
        kind: "code_layer",
        role: "layer",
        label: info.rawLayer,
        group: info.unitSlug,
        ownerId: info.unitId,
        provenance: { file: info.sampleFile },
        tags: ["typescript", "layer", info.canonicalLayer, sem.axis],
        meta: {
          unit: info.unitName,
          fileCount: info.count,
          canonicalLayer: info.canonicalLayer,
          layerAxis: sem.axis,
          layerRank: sem.rank,
          laneId: sem.laneId,
          laneLabel: sem.laneLabel,
        },
      });
      if (validUnitIds.has(info.unitId)) {
        edges.push({
          from: info.unitId,
          to: lid,
          kind: "contains",
          confidence: "observed",
          provenance: { file: info.sampleFile },
        });
      }
    }

    const domainCountsSorted = Array.from(domainFileCounts.entries())
      .filter(([, v]) => v.count >= 2)
      .sort((a, b) => (b[1].count !== a[1].count ? b[1].count - a[1].count : a[0].localeCompare(b[0])));

    const validDomainIds = new Set<string>();
    for (const [dom, info] of domainCountsSorted) {
      const did = `arch:domain:${dom}`;
      validDomainIds.add(did);
      nodes.push({
        id: did,
        domain: "arch",
        kind: "domain_area",
        role: "domain",
        label: dom,
        group: domainConfig.hasDeclaredDomains ? "declared-domain" : "inferred-domain",
        provenance: { file: info.sampleFile },
        tags: ["domain", domainConfig.hasDeclaredDomains ? "declared" : "inferred"],
        meta: { fileCount: info.count, declared: domainConfig.hasDeclaredDomains },
      });
    }

    if (ast.entityAccesses.length > 0 || ast.declaredEntities.length > 0) {
      const fsId = "arch:datastore:firestore";
      const uniqueCols = new Set([
        ...ast.declaredEntities.map((d) => d.entity),
        ...ast.entityAccesses.map((a) => a.entity),
      ]);
      nodes.push({
        id: fsId,
        domain: "arch",
        kind: "datastore",
        role: "datastore",
        label: "Firestore",
        group: "datastore",
        provenance: { file: indexesRel ?? ast.entityAccesses[0]?.file ?? "." },
        tags: ["firestore", "datastore"],
        meta: { collectionCount: uniqueCols.size, accessCount: ast.entityAccesses.length },
      });

      for (const [layerId, evList] of Array.from(layerDatastoreEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
        if (!validLayerIds.has(layerId)) continue;
        edges.push({
          from: layerId,
          to: fsId,
          kind: "reads_writes",
          label: `${evList.length} refs`,
          weight: evList.length,
          confidence: "observed",
          provenance: evList[0] ? { file: evList[0].file, line: evList[0].line } : undefined,
          evidence: evList.slice(0, 15),
        });
      }
      for (const [unitId, evList] of Array.from(unitDatastoreEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
        if (!validUnitIds.has(unitId)) continue;
        edges.push({
          from: unitId,
          to: fsId,
          kind: "reads_writes",
          label: `${uniqueCols.size} colls`,
          weight: evList.length,
          confidence: "observed",
          provenance: evList[0] ? { file: evList[0].file, line: evList[0].line } : undefined,
          evidence: evList.slice(0, 15),
        });
      }
    }

    const extNodesMap = new Map<string, { label: string; category: string; count: number; sampleFile: string }>();
    for (const [key, entry] of Array.from(unitExternalEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const [unitId, extId] = key.split(">");
      if (!unitId || !extId || !validUnitIds.has(unitId)) continue;
      const cur = extNodesMap.get(extId);
      if (cur) cur.count += entry.evidence.length;
      else {
        extNodesMap.set(extId, {
          label: entry.label,
          category: entry.category,
          count: entry.evidence.length,
          sampleFile: entry.evidence[0]?.file ?? ".",
        });
      }
      edges.push({
        from: unitId,
        to: extId,
        kind: "calls_external",
        label: entry.category,
        weight: entry.evidence.length,
        confidence: "observed",
        provenance: entry.evidence[0] ? { file: entry.evidence[0].file, line: entry.evidence[0].line } : undefined,
        evidence: entry.evidence.slice(0, 10),
      });
    }

    for (const [extId, info] of Array.from(extNodesMap.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      nodes.push({
        id: extId,
        domain: "arch",
        kind: "external_service",
        role: "external",
        label: info.label,
        group: info.category,
        provenance: { file: info.sampleFile },
        tags: ["external", info.category],
        meta: { category: info.category, refCount: info.count },
      });
    }

    for (const [key, entry] of Array.from(layerExternalEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const [layerId, extId] = key.split(">");
      if (!layerId || !extId || !validLayerIds.has(layerId) || !extNodesMap.has(extId)) continue;
      edges.push({
        from: layerId,
        to: extId,
        kind: "calls_external",
        label: entry.label,
        weight: entry.evidence.length,
        confidence: "observed",
        provenance: entry.evidence[0] ? { file: entry.evidence[0].file, line: entry.evidence[0].line } : undefined,
        evidence: entry.evidence.slice(0, 10),
      });
    }

    for (const [key, evList] of Array.from(layerPairEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const [fromKey, toKey] = key.split(">");
      if (!fromKey || !toKey) continue;
      const fromId = `arch:layer:${fromKey}`;
      const toId = `arch:layer:${toKey}`;
      if (!validLayerIds.has(fromId) || !validLayerIds.has(toId)) continue;
      edges.push({
        from: fromId,
        to: toId,
        kind: "imports_layer",
        label: String(evList.length),
        weight: evList.length,
        confidence: "observed",
        provenance: evList[0] ? { file: evList[0].file, line: evList[0].line } : undefined,
        evidence: evList.slice(0, 15),
      });
    }

    for (const [key, evList] of Array.from(domainPairEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      if (evList.length < 2) continue;
      const [fromD, toD] = key.split(">");
      if (!fromD || !toD) continue;
      const fromId = `arch:domain:${fromD}`;
      const toId = `arch:domain:${toD}`;
      if (!validDomainIds.has(fromId) || !validDomainIds.has(toId)) continue;
      edges.push({
        from: fromId,
        to: toId,
        kind: "imports_domain",
        label: String(evList.length),
        weight: evList.length,
        confidence: "observed",
        provenance: evList[0] ? { file: evList[0].file, line: evList[0].line } : undefined,
        evidence: evList.slice(0, 10),
      });
    }

}
