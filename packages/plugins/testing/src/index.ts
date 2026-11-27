import { Plugin } from "@repospec/plugin";
import { testingAndRulesExtractor } from "./testingAndRules.ts";

export { testingAndRulesExtractor };

export const testingPlugin = Plugin.define({
  id: "repospec.testing",
  async setup(ctx) {
    await ctx.extractor.transform((ed) => {
      ed.add(testingAndRulesExtractor);
    });
  },
});

export default testingPlugin;
