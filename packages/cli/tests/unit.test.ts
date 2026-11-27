import { describe, expect, test } from "bun:test";
import { buildPluginOperations, resolveGenerateOutDir } from "@repospec/cli";

describe("@repospec/cli unit invariants (R2)", () => {
  test("buildPluginOperations parses comma-separated add/remove targets and resolveGenerateOutDir honors flags", () => {
    const ops = buildPluginOperations("./a, ./b", "repospec.lang.rust");
    expect(ops).toEqual([
      { type: "add", target: "./a" },
      { type: "add", target: "./b" },
      { type: "remove", target: "repospec.lang.rust" },
    ]);
    const out = resolveGenerateOutDir({
      repoDir: "/tmp/demo-repo",
      explicitOut: "/tmp/custom-out",
      inPlace: false,
      storageMode: "artifact",
      hasExistingDotRepospec: false,
    });
    expect(out.outDir).toBe("/tmp/custom-out");
  });
});
