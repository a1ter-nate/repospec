import { Plugin } from "@repospec/plugin";
import { ciExtractor } from "./ci.ts";

export { ciExtractor };

export const ciPlugin = Plugin.define({
  id: "repospec.ci",
  async setup(ctx) {
    await ctx.extractor.transform((ed) => {
      ed.add(ciExtractor);
    });
  },
});

export default ciPlugin;
