import fs from "node:fs";
import path from "node:path";
import type {
  AstIndexData,
  CanonicalLayer,
  RepoContext,
  SpecEdge,
  SpecNode,
  SpecRule,
  UnitDescriptor,
} from "@repospec/plugin";
import { resolveLayerSemantics } from "@repospec/plugin";

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

export function classifyCsharpLayer(
  relFile: string,
  text: string,
  proj: UnitDescriptor | null,
): { rawLayer: string; canonicalLayer: CanonicalLayer } {
  const lower = `${proj?.name ?? ""}/${relFile}`.toLowerCase();
  if (proj?.kind === "analyzer" || lower.includes("analyzer") || /\[DiagnosticAnalyzer/.test(text)) {
    return { rawLayer: "analyzers", canonicalLayer: "analyzer" };
  }
  if (proj?.kind === "test_package" || /Tests?\.cs$/i.test(relFile) || /\[(Fact|Theory|Property|Test|TestMethod)\b/.test(text)) {
    return { rawLayer: "tests", canonicalLayer: "tests" };
  }
  if (lower.includes("controller") || lower.includes("endpoint") || /:\s*ControllerBase|Map(?:Get|Post|Put|Delete)\s*\(/.test(text)) {
    return { rawLayer: "endpoints", canonicalLayer: "transport" };
  }
  if (lower.includes("repository") || lower.includes("persistence") || lower.includes("infrastructure") || /:\s*DbContext\b/.test(text)) {
    return { rawLayer: "data", canonicalLayer: "persistence" };
  }
  if (lower.includes("service") || lower.includes("handler") || lower.includes("application")) {
    return { rawLayer: "application", canonicalLayer: "orchestration" };
  }
  if (lower.includes("client") || lower.includes("gateway") || lower.includes("adapter")) {
    return { rawLayer: "clients", canonicalLayer: "integration" };
  }
  if (lower.includes("domain") || lower.includes("model") || /\babstract\s+record\b/.test(text)) {
    return { rawLayer: "domain", canonicalLayer: "domain" };
  }
  return { rawLayer: "core", canonicalLayer: "domain" };
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
    if (ast.declaredEntities.length > 0) {
      nodes.push({
        id: "arch:datastore:efcore",
        domain: "arch",
        kind: "datastore",
        role: "datastore",
        label: "EF Core DbContext",
        group: "datastore",
        provenance: { file: ast.declaredEntities[0]?.declaredAt ?? "." },
        tags: ["csharp", "efcore", "datastore"],
        meta: { entityCount: ast.declaredEntities.length },
      });
    }

    for (const [, info] of Array.from(layerCounts.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      if (!validUnitIds.has(info.projId)) continue;
      const lid = `arch:layer:${info.projName}:${info.layer}`;
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
