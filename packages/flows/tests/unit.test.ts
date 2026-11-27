import { describe, expect, test } from "bun:test";
import { buildFlowAnalysisFromFacts, flowExtractorPlugin } from "@repospec/flows";
import { defineFlowLanguage } from "@repospec/flows/languages";

describe("@repospec/flows unit invariants (R2)", () => {
  test("exposes flowExtractorPlugin, defineFlowLanguage, and empty-fact analysis", () => {
    expect(flowExtractorPlugin.id).toBe("flows.work-and-lifecycle.v1");
    const lang = defineFlowLanguage({ id: "sample", label: "Sample", extensions: [".x"], extractFlows: () => [] });
    expect(lang.extensions).toEqual([".x"]);
    const bundle = buildFlowAnalysisFromFacts([]);
    expect(bundle.workFlows).toEqual([]);
    expect(bundle.entityLifecycles).toEqual([]);
  });
});
