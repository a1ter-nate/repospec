import { Plugin } from "@repospec/plugin";
import { classifyTerraformPlane, iacExtractor, isDeployableComputeResource } from "./iac.ts";

export { classifyTerraformPlane, iacExtractor, isDeployableComputeResource };

export const iacPlugin = Plugin.define({
  id: "repospec.iac",
  async setup(ctx) {
    await ctx.extractor.transform((ed) => {
      ed.add(iacExtractor);
    });
  },
});

export default iacPlugin;
