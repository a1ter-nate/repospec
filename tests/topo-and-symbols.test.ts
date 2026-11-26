import { describe, expect, test } from "bun:test";
import zlib from "node:zlib";
import {
  buildLanesForLevels,
  computeTopologicalLevels,
  peelUnitModulePaths,
  summarizeModuleMetadata,
} from "../src/internal/topoLevels.ts";
import type { AstFileFact } from "../src/schema.ts";
import { extractFileCallGraph, packSourceArchiveBase64 } from "../src/studio/fileSymbols.ts";

function makeFileFact(file: string, overrides: Partial<AstFileFact> = {}): AstFileFact {
  return {
    file,
    unit: "@unit/app",
    language: "typescript",
    layer: "core",
    canonicalLayer: "domain",
    domainArea: null,
    layerSource: "path_convention",
    domainSource: "none",
    isTest: false,
    isBarrel: false,
    lines: 40,
    exportsCount: 2,
    ...overrides,
  };
}

describe("Topological levels & file symbol analysis (R2 pure unit)", () => {
  test("computeTopologicalLevels computes monotone longest-path levels on a DAG with zero tangles", () => {
    const res = computeTopologicalLevels(
      ["entry", "svc", "repo", "util"],
      [
        { from: "entry", to: "svc" },
        { from: "svc", to: "repo" },
        { from: "entry", to: "util" },
        { from: "repo", to: "util" },
      ],
    );

    expect(res.inTangle.size).toBe(0);
    expect(res.levels.get("entry")).toBe(0);
    expect(res.levels.get("svc")).toBe(1);
    expect(res.levels.get("repo")).toBe(2);
    expect(res.levels.get("util")).toBe(3);
  });

  test("computeTopologicalLevels detects multi-node strongly connected components as tangles", () => {
    const res = computeTopologicalLevels(
      ["cli", "alpha", "beta", "leaf"],
      [
        { from: "cli", to: "alpha" },
        { from: "alpha", to: "beta" },
        { from: "beta", to: "alpha" },
        { from: "beta", to: "leaf" },
      ],
    );

    expect(res.inTangle.get("alpha")).toBe("tangle-1");
    expect(res.inTangle.get("beta")).toBe("tangle-1");
    expect(res.inTangle.has("cli")).toBe(false);
    expect(res.inTangle.has("leaf")).toBe(false);
    expect(res.levels.get("cli")).toBe(0);
    expect(res.levels.get("alpha")).toBe(1);
    expect(res.levels.get("beta")).toBe(1);
    expect(res.levels.get("leaf")).toBe(2);
  });

  test("buildLanesForLevels adapts lane count to depth and routes standalone modules laterally", () => {
    const shallow = buildLanesForLevels(1, false);
    expect(shallow.laneOrder.map((l) => l.id)).toEqual(["L0", "L1"]);
    expect(shallow.laneIdFor(0, false)).toBe("L0");
    expect(shallow.laneIdFor(1, false)).toBe("L1");

    const deep = buildLanesForLevels(7, true);
    expect(deep.laneOrder.map((l) => l.id)).toEqual(["L0", "L1", "L2", "L3", "L4", "standalone"]);
    expect(deep.laneOrder[5]?.lateral).toBe(true);
    expect(deep.laneIdFor(0, false)).toBe("L0");
    expect(deep.laneIdFor(7, false)).toBe("L4");
    expect(deep.laneIdFor(2, true)).toBe("standalone");
  });

  test("peelUnitModulePaths peels redundant single wrappers and dominant slug folders", () => {
    const nested = peelUnitModulePaths(
      [makeFileFact("apps/api/src/internal/a.ts"), makeFileFact("apps/api/src/internal/b.ts")],
      "apps/api",
      "api",
    );
    expect(nested.map((x) => x.rel)).toEqual(["a.ts", "b.ts"]);

    const slugDominated = peelUnitModulePaths(
      [
        makeFileFact("pkgs/orders/src/orders/create.ts"),
        makeFileFact("pkgs/orders/src/orders/cancel.ts"),
        makeFileFact("pkgs/orders/src/orders/refund.ts"),
        makeFileFact("pkgs/orders/src/orders/list.ts"),
        makeFileFact("pkgs/orders/src/shared/types.ts"),
      ],
      "pkgs/orders",
      "orders",
    );
    expect(slugDominated.map((x) => x.rel)).toEqual([
      "create.ts",
      "cancel.ts",
      "refund.ts",
      "list.ts",
      "shared/types.ts",
    ]);
  });

  test("summarizeModuleMetadata orders capabilities and ranks exported symbols capped at 12", () => {
    const pureSummary = summarizeModuleMetadata([makeFileFact("src/pure.ts")]);
    expect(pureSummary.capabilities).toEqual(["PURE"]);

    const mixedSummary = summarizeModuleMetadata([
      makeFileFact("src/a.ts", {
        capabilities: ["ENV", "DB"],
        exportedSymbols: [
          { name: "Config", kind: "type", file: "src/a.ts", line: 1 },
          { name: "createOrder", kind: "route", file: "src/a.ts", line: 10 },
          { name: "runCli", kind: "command", file: "src/a.ts", line: 20 },
        ],
      }),
      makeFileFact("src/b.ts", {
        capabilities: ["HTTP"],
        exportedSymbols: [
          { name: "createOrder", kind: "route", file: "src/b.ts", line: 5 },
          { name: "OrderRepo", kind: "class", file: "src/b.ts", line: 12 },
        ],
      }),
    ]);

    expect(mixedSummary.capabilities).toEqual(["DB", "HTTP", "ENV"]);
    expect(mixedSummary.topExports.map((s) => `${s.kind}:${s.name}`)).toEqual([
      "route:createOrder",
      "command:runCli",
      "class:OrderRepo",
      "type:Config",
    ]);
  });

  test("extractFileCallGraph parses TS, Python, Rust, and C# symbols and packSourceArchiveBase64 round-trips", () => {
    const tsSource = [
      'import { saveOrder } from "./repo.ts";',
      "function helper(x: number): number {",
      "  return x + 1;",
      "}",
      "export function processOrder(id: number): number {",
      "  saveOrder(id);",
      "  return helper(id);",
      "}",
    ].join("\n");
    const tsGraph = extractFileCallGraph("src/orders.ts", tsSource);
    expect(tsGraph.m.map((s) => `${s[1]}:${s[0]}`)).toEqual(["priv:helper", "pub:processOrder"]);
    expect(tsGraph.k).toHaveLength(1);
    expect(tsGraph.o.map((e) => e[1])).toEqual(["repo.saveOrder"]);

    const pyGraph = extractFileCallGraph(
      "worker.py",
      "from db import query\ndef _clean(v):\n  return v\ndef run(v):\n  query(v)\n  return _clean(v)\n",
    );
    expect(pyGraph.m.map((s) => `${s[1]}:${s[0]}`)).toEqual(["priv:_clean", "pub:run"]);
    expect(pyGraph.k).toHaveLength(1);

    const rsGraph = extractFileCallGraph(
      "lib.rs",
      "pub fn handle() {\n  validate();\n}\nfn validate() {\n}\n",
    );
    expect(rsGraph.m.map((s) => `${s[1]}:${s[0]}`)).toEqual(["pub:handle", "priv:validate"]);
    expect(rsGraph.k).toHaveLength(1);

    const csGraph = extractFileCallGraph(
      "Orders.cs",
      "public class OrderService {\n  public void Execute() {\n    Validate();\n  }\n  private void Validate() {\n  }\n}\n",
    );
    expect(csGraph.m.map((s) => `${s[1]}:${s[0]}`)).toEqual(["pub:Execute", "priv:Validate"]);
    expect(csGraph.k).toHaveLength(1);

    const packed = packSourceArchiveBase64(["alpha", "beta"]);
    const decoded = JSON.parse(zlib.gunzipSync(Buffer.from(packed, "base64")).toString("utf8")) as string[];
    expect(decoded).toEqual(["alpha", "beta"]);
  });
});
