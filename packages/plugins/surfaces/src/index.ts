import { Plugin } from "@repospec/plugin";
import { surfacesAndGovernanceExtractor } from "./surfacesAndGovernance.ts";

export { surfacesAndGovernanceExtractor };

export const surfacesPlugin = Plugin.define({
  id: "repospec.surfaces",
  async setup(ctx) {
    await ctx.extractor.transform((ed) => {
      ed.add(surfacesAndGovernanceExtractor);
    });
  },
});

export default surfacesPlugin;
