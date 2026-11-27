import { describe, expect, test } from "bun:test";
import {
  buildRepoSpecJsonSchema,
  createEmptyAst,
  diffFactSets,
  fromPromise,
  Plugin,
  resolveLayerSemantics,
} from "@repospec/plugin";

describe("@repospec/plugin SDK unit invariants (R2)", () => {
  test("define, fromPromise, taxonomy, diffFactSets, and JSON schema work standalone", () => {
    const p = Plugin.define({ id: "sdk.unit.test", setup() {} });
    const adapted = fromPromise(p);
    expect(typeof adapted.effect).toBe("function");
    expect(adapted.id).toBe("sdk.unit.test");
    expect(createEmptyAst().files).toEqual([]);
    expect(resolveLayerSemantics("service", "domain").rank).toBeGreaterThanOrEqual(0);
    expect(buildRepoSpecJsonSchema().type).toBe("object");
    const diff = diffFactSets(
      [{ extractorId: "a", kind: "k", key: "1", file: "f.ts", line: 1, unit: "u", payload: {} }],
      [{ extractorId: "a", kind: "k", key: "2", file: "f.ts", line: 2, unit: "u", payload: {} }],
      "k",
    );
    expect(diff.added.length).toBe(1);
    expect(diff.removed.length).toBe(1);
  });
});
