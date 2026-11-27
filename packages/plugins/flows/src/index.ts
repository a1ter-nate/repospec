import { flowExtractorPlugin } from "@repospec/flows";
import { Plugin } from "@repospec/plugin";

export { flowExtractorPlugin };

export const flowsPlugin = Plugin.define({
  id: "repospec.flows",
  async setup(ctx) {
    await ctx.extractor.transform((ed) => {
      ed.add(flowExtractorPlugin);
    });
  },
});

export default flowsPlugin;
