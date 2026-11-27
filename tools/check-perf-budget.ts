import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeFragments } from "@repospec/core";
import type { GraphFragment, SpecEdge, SpecNode } from "@repospec/plugin";
import { extractFileCallGraph } from "@repospec/plugin-studio";

function buildSyntheticWorkload(n: number): {
  fragment: GraphFragment;
  sourceCode: string;
} {
  const nodes: SpecNode[] = [];
  const edges: SpecEdge[] = [];
  const nodeIds: string[] = [];
  const fnLines: string[] = [];

  for (let i = 0; i < n; i += 1) {
    const id = `arch:mod:m${String(i).padStart(4, "0")}`;
    nodeIds.push(id);
    nodes.push({
      id,
      domain: "arch",
      kind: "package",
      label: `mod-${i}`,
      provenance: { file: `src/mod_${i}.ts` },
      tags: ["bench", i % 2 === 0 ? "core" : "domain"],
      meta: { index: i, bucket: i % 5 },
    });
    if (i < 48) {
      fnLines.push(`export function fn_${i}(x: number): number { return x + ${i}; }`);
    }
  }

  for (let i = 0; i < n - 1; i += 1) {
    const from = nodeIds[i];
    const toA = nodeIds[i + 1];
    if (from && toA) {
      edges.push({ from, to: toA, kind: "depends_on", weight: 1, confidence: "observed" });
    }
    const toB = nodeIds[i + 3];
    if (from && toB) {
      edges.push({ from, to: toB, kind: "depends_on", weight: 1, confidence: "observed" });
    }
  }

  return {
    fragment: { nodes, edges, rules: [] },
    sourceCode: fnLines.join("\n"),
  };
}

function measureWorkloadMs(n: number, rounds: number): number {
  const { fragment, sourceCode } = buildSyntheticWorkload(n);
  const start = performance.now();
  let checksum = 0;
  for (let r = 0; r < rounds; r += 1) {
    const merged = mergeFragments([fragment]);
    const callGraph = extractFileCallGraph("src/bench.ts", sourceCode);
    checksum += merged.nodes.length + merged.edges.length + callGraph.m.length;
  }
  const elapsed = performance.now() - start;
  if (checksum <= 0) throw new Error("Unexpected empty benchmark checksum");
  return Number((elapsed / rounds).toFixed(4));
}

function medianWorkloadMs(n: number, rounds: number): number {
  const trials = [
    measureWorkloadMs(n, rounds),
    measureWorkloadMs(n, rounds),
    measureWorkloadMs(n, rounds),
  ].sort((a, b) => a - b);
  return trials[1] ?? trials[0] ?? 0.05;
}

function main(): void {
  measureWorkloadMs(128, 4);
  measureWorkloadMs(256, 3);

  const sizes = [200, 400, 800, 1600, 3200];
  const samples = sizes.map((n) => ({
    n,
    timeMs: Math.max(0.05, medianWorkloadMs(n, 4)),
  }));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-bigo-"));
  const sampleFile = path.join(tmpDir, "samples.json");
  try {
    fs.writeFileSync(
      sampleFile,
      JSON.stringify({ samples, maxTimeExponent: 1.45 }, null, 2),
      "utf8",
    );
    const res = Bun.spawnSync(["bunx", "vstack", "big-o", sampleFile, "--fail"], {
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exit(res.exitCode ?? 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
