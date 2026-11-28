import fs from "node:fs";
import path from "node:path";
import type {
  AstIndexData,
  CanonicalLayer,
  EdgeEvidenceItem,
  RepoContext,
  SpecEdge,
  SpecNode,
  SpecRule,
  UnitDescriptor,
} from "@repospec/plugin";
import {
  classifyExternalPackage,
  isNonDomainBucket,
  resolveFeatureOrLayerPath,
  resolveLayerSemantics,
  singularize,
} from "@repospec/plugin";

export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

export function walkCsFilesInDir(absDir: string, rootDir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (["bin", "obj", ".git", "node_modules"].includes(e.name)) continue;
      walkCsFilesInDir(path.join(absDir, e.name), rootDir, out);
    } else if (e.isFile() && e.name.endsWith(".cs")) {
      out.push(path.relative(rootDir, path.join(absDir, e.name)).replace(/\\/g, "/"));
    }
  }
  return out;
}

function inferCsharpDomainArea(relFile: string, proj: UnitDescriptor | null): string | null {
  const pathInfo = resolveFeatureOrLayerPath(relFile, proj?.dir ?? ".");
  if (pathInfo.inferredDomain) return pathInfo.inferredDomain;
  const base = path.posix.basename(relFile, ".cs");
  const m = base.match(/^([A-Z][a-z0-9]+)(?:Controller|Endpoints?|Service|Repository|Repo|Handler|Consumer|Hub|Job|Worker)$/);
  if (m?.[1] && !isNonDomainBucket(m[1])) return singularize(m[1]);
  return null;
}

export function classifyCsharpLayer(
  relFile: string,
  text: string,
  proj: UnitDescriptor | null,
): { rawLayer: string; canonicalLayer: CanonicalLayer; domainArea: string | null } {
  const lower = `${proj?.name ?? ""}/${relFile}`.toLowerCase();
  const domainArea = inferCsharpDomainArea(relFile, proj);
  if (proj?.kind === "analyzer" || lower.includes("analyzer") || /\[DiagnosticAnalyzer/.test(text)) {
    return { rawLayer: "analyzers", canonicalLayer: "analyzer", domainArea: null };
  }
  if (
    proj?.kind === "test_package" ||
    /Tests?\.cs$/i.test(relFile) ||
    /\[(Fact|Theory|Property|Test|TestCase|TestMethod|DataTestMethod)\b/.test(text)
  ) {
    return { rawLayer: "tests", canonicalLayer: "tests", domainArea: null };
  }
  if (
    lower.includes("controller") ||
    lower.includes("endpoint") ||
    lower.includes("/hubs/") ||
    lower.includes("middleware") ||
    /:\s*(?:ControllerBase|Controller|Hub|Endpoint<)\b|\.Map(?:Get|Post|Put|Patch|Delete|Group|Hub)\s*\(|\[ApiController\b/.test(text)
  ) {
    return { rawLayer: "endpoints", canonicalLayer: "transport", domainArea };
  }
  if (
    lower.includes("repository") ||
    lower.includes("persistence") ||
    lower.includes("infrastructure") ||
    lower.includes("/migrations/") ||
    lower.includes("/data/") ||
    /:\s*(?:Identity)?DbContext\b|IEntityTypeConfiguration<|migrationBuilder\./.test(text)
  ) {
    return { rawLayer: "data", canonicalLayer: "persistence", domainArea };
  }
  if (
    lower.includes("/workers/") ||
    lower.includes("/jobs/") ||
    lower.includes("/consumers/") ||
    /:\s*(?:BackgroundService|IHostedService|IJob)\b|IConsumer</.test(text)
  ) {
    return { rawLayer: "workers", canonicalLayer: "runtime_loop", domainArea };
  }
  if (lower.includes("service") || lower.includes("handler") || lower.includes("application") || lower.includes("usecase")) {
    return { rawLayer: "application", canonicalLayer: "orchestration", domainArea };
  }
  if (lower.includes("client") || lower.includes("gateway") || lower.includes("adapter")) {
    return { rawLayer: "clients", canonicalLayer: "integration", domainArea };
  }
  if (lower.includes("dto") || lower.includes("contract") || lower.includes("extension") || lower.includes("exception") || lower.includes("config")) {
    return { rawLayer: "support", canonicalLayer: "support", domainArea };
  }
  if (lower.includes("domain") || lower.includes("model") || lower.includes("entit") || /\babstract\s+record\b/.test(text)) {
    return { rawLayer: "domain", canonicalLayer: "domain", domainArea };
  }
  return { rawLayer: "core", canonicalLayer: "domain", domainArea };
}

function appendEvidence(map: Map<string, EdgeEvidenceItem[]>, key: string, item: EdgeEvidenceItem): void {
  const list = map.get(key) ?? [];
  if (list.length < 15) list.push(item);
  map.set(key, list);
}

export function emitCsharpGraph(params: {
  ctx: RepoContext;
  csUnits: UnitDescriptor[];
  validUnitIds: Set<string>;
  ast: AstIndexData;
  layerCounts: Map<string, { projName: string; projId: string; layer: string; canonicalLayer: CanonicalLayer; count: number; sampleFile: string }>;
  nodes: SpecNode[];
  edges: SpecEdge[];
  rules: SpecRule[];
}): void {
  const { ctx, csUnits, validUnitIds, ast, layerCounts, nodes, edges, rules } = params;
  const unitIdByName = new Map(csUnits.map((u) => [u.name, u.id]));
  const validLayerIds = new Set<string>();

  for (const [, info] of Array.from(layerCounts.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    if (!validUnitIds.has(info.projId)) continue;
    const lid = `arch:layer:${info.projName}:${info.layer}`;
    validLayerIds.add(lid);
    const sem = resolveLayerSemantics(info.layer, info.canonicalLayer);
    nodes.push({
      id: lid,
      domain: "arch",
      kind: "code_layer",
      role: "layer",
      label: info.layer,
      group: info.projName,
      ownerId: info.projId,
      provenance: { file: info.sampleFile },
      tags: ["csharp", "layer", info.canonicalLayer, sem.axis],
      meta: {
        unit: info.projName,
        fileCount: info.count,
        canonicalLayer: info.canonicalLayer,
        layerAxis: sem.axis,
        layerRank: sem.rank,
        laneId: sem.laneId,
        laneLabel: sem.laneLabel,
      },
    });
    edges.push({
      from: info.projId,
      to: lid,
      kind: "contains",
      confidence: "observed",
      provenance: { file: info.sampleFile },
    });
  }

  const domainCounts = new Map<string, { count: number; sampleFile: string }>();
  for (const f of ast.files) {
    if (f.isTest || !f.domainArea) continue;
    const cur = domainCounts.get(f.domainArea);
    if (cur) cur.count += 1;
    else domainCounts.set(f.domainArea, { count: 1, sampleFile: f.file });
  }
  const validDomainIds = new Set<string>();
  for (const [dom, info] of Array.from(domainCounts.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    if (info.count < 2) continue;
    const did = `arch:domain:${dom}`;
    validDomainIds.add(did);
    nodes.push({
      id: did,
      domain: "arch",
      kind: "domain_area",
      role: "domain",
      label: dom,
      group: "inferred-domain",
      provenance: { file: info.sampleFile },
      tags: ["csharp", "domain", "inferred"],
      meta: { fileCount: info.count, declared: false },
    });
  }

  const layerPairEv = new Map<string, EdgeEvidenceItem[]>();
  const domainPairEv = new Map<string, EdgeEvidenceItem[]>();
  for (const imp of ast.fileImports) {
    if (imp.fromCanonicalLayer === "tests" || imp.toCanonicalLayer === "tests") continue;
    const fromLid = `arch:layer:${imp.fromUnit}:${imp.fromLayer}`;
    const toLid = `arch:layer:${imp.toUnit}:${imp.toLayer}`;
    if (fromLid !== toLid && validLayerIds.has(fromLid) && validLayerIds.has(toLid)) {
      appendEvidence(layerPairEv, `${fromLid}>${toLid}`, {
        file: imp.fromFile,
        line: imp.line,
        detail: `imports ${imp.toFile}`,
      });
    }
    if (imp.fromDomain && imp.toDomain && imp.fromDomain !== imp.toDomain) {
      const fromDid = `arch:domain:${imp.fromDomain}`;
      const toDid = `arch:domain:${imp.toDomain}`;
      if (validDomainIds.has(fromDid) && validDomainIds.has(toDid)) {
        appendEvidence(domainPairEv, `${fromDid}>${toDid}`, {
          file: imp.fromFile,
          line: imp.line,
          detail: `${imp.fromDomain} -> ${imp.toDomain}`,
        });
      }
    }
  }
  for (const [key, evList] of Array.from(layerPairEv.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const [fromId, toId] = key.split(">");
    if (!fromId || !toId) continue;
    edges.push({
      from: fromId,
      to: toId,
      kind: "imports_layer",
      label: String(evList.length),
      weight: evList.length,
      confidence: "observed",
      provenance: evList[0] ? { file: evList[0].file, line: evList[0].line } : undefined,
      evidence: evList,
    });
  }
  for (const [key, evList] of Array.from(domainPairEv.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    if (evList.length < 2) continue;
    const [fromId, toId] = key.split(">");
    if (!fromId || !toId) continue;
    edges.push({
      from: fromId,
      to: toId,
      kind: "imports_domain",
      label: String(evList.length),
      weight: evList.length,
      confidence: "observed",
      provenance: evList[0] ? { file: evList[0].file, line: evList[0].line } : undefined,
      evidence: evList,
    });
  }

  if (ast.declaredEntities.length > 0 || ast.entityAccesses.length > 0) {
    const hasEf = ast.declaredEntities.some((d) => d.datastore === "efcore") || ast.entityAccesses.some((a) => a.datastore === "efcore");
    const dsId = hasEf ? "arch:datastore:efcore" : "arch:datastore:sql";
    const uniqueEnts = new Set([
      ...ast.declaredEntities.map((d) => d.entity),
      ...ast.entityAccesses.map((a) => a.entity),
    ]);
    nodes.push({
      id: dsId,
      domain: "arch",
      kind: "datastore",
      role: "datastore",
      label: hasEf ? "EF Core DbContext" : "SQL Datastore",
      group: "datastore",
      provenance: { file: ast.declaredEntities[0]?.declaredAt ?? ast.entityAccesses[0]?.file ?? "." },
      tags: ["csharp", hasEf ? "efcore" : "sql", "datastore"],
      meta: { entityCount: uniqueEnts.size, accessCount: ast.entityAccesses.length },
    });
    const unitDsEv = new Map<string, EdgeEvidenceItem[]>();
    const layerDsEv = new Map<string, EdgeEvidenceItem[]>();
    for (const acc of ast.entityAccesses) {
      const ev: EdgeEvidenceItem = { file: acc.file, line: acc.line, detail: `${acc.op} ${acc.entity}` };
      const uid = unitIdByName.get(acc.unit);
      if (uid && validUnitIds.has(uid)) appendEvidence(unitDsEv, uid, ev);
      const lid = `arch:layer:${acc.unit}:${acc.layer}`;
      if (validLayerIds.has(lid)) appendEvidence(layerDsEv, lid, ev);
    }
    for (const [uid, evList] of Array.from(unitDsEv.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      edges.push({
        from: uid,
        to: dsId,
        kind: "reads_writes",
        label: `${evList.length} refs`,
        weight: evList.length,
        confidence: "observed",
        provenance: evList[0] ? { file: evList[0].file, line: evList[0].line } : undefined,
        evidence: evList,
      });
    }
    for (const [lid, evList] of Array.from(layerDsEv.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      edges.push({
        from: lid,
        to: dsId,
        kind: "reads_writes",
        label: `${evList.length} refs`,
        weight: evList.length,
        confidence: "observed",
        provenance: evList[0] ? { file: evList[0].file, line: evList[0].line } : undefined,
        evidence: evList,
      });
    }
  }

  const extNodesMap = new Map<string, { label: string; category: string; count: number; sampleFile: string }>();
  const unitExtEv = new Map<string, { category: string; label: string; evidence: EdgeEvidenceItem[] }>();
  const recordExt = (unitName: string, extId: string, label: string, category: string, ev: EdgeEvidenceItem): void => {
    const uid = unitIdByName.get(unitName);
    if (!uid || !validUnitIds.has(uid)) return;
    const curNode = extNodesMap.get(extId);
    if (curNode) curNode.count += 1;
    else extNodesMap.set(extId, { label, category, count: 1, sampleFile: ev.file });
    const key = `${uid}>${extId}`;
    const curEv = unitExtEv.get(key) ?? { category, label, evidence: [] };
    if (curEv.evidence.length < 10) curEv.evidence.push(ev);
    unitExtEv.set(key, curEv);
  };

  for (const pkgImp of ast.pkgImports) {
    if (pkgImp.canonicalLayer === "tests") continue;
    const cls = classifyExternalPackage(pkgImp.pkg);
    if (!cls || cls.kind !== "service") continue;
    const slug = cls.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) continue;
    recordExt(pkgImp.unit, `arch:external:${slug}`, cls.label, cls.category, {
      file: pkgImp.fromFile,
      line: pkgImp.line,
      detail: pkgImp.pkg,
    });
  }
  for (const hostRef of ast.externalHosts) {
    const slug = hostRef.host.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) continue;
    recordExt(hostRef.unit, `arch:external:${slug}`, hostRef.host, "http_api", {
      file: hostRef.file,
      line: hostRef.line,
      detail: hostRef.host,
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
      tags: ["csharp", "external", info.category],
      meta: { category: info.category, refCount: info.count },
    });
  }
  for (const [key, entry] of Array.from(unitExtEv.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const [uid, extId] = key.split(">");
    if (!uid || !extId) continue;
    edges.push({
      from: uid,
      to: extId,
      kind: "calls_external",
      label: entry.category,
      weight: entry.evidence.length,
      confidence: "observed",
      provenance: entry.evidence[0] ? { file: entry.evidence[0].file, line: entry.evidence[0].line } : undefined,
      evidence: entry.evidence,
    });
  }

  const strykerFile = ctx.allFiles.find((f) => f.endsWith("stryker-config.json"));
  if (strykerFile) {
    const id = "rule:config:dotnet-stryker";
    nodes.push({
      id,
      domain: "rules",
      kind: "linter_config",
      role: "rule",
      label: "Stryker.NET Mutation Config",
      group: "static_config",
      provenance: { file: strykerFile, line: 1 },
      tags: ["R5", "csharp", "mutation"],
      meta: { file: strykerFile },
    });
    rules.push({
      id,
      name: "dotnet-stryker-mutation",
      category: "lint_ratchet",
      enforcement: "executed",
      rung: "R5",
      statement: `Stryker.NET mutation testing configured in ${strykerFile}`,
      targets: csUnits.filter((u) => u.kind === "package").map((u) => u.id),
      provenance: { file: strykerFile, line: 1 },
    });
  }
}
