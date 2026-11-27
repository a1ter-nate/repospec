import { Plugin } from "@repospec/plugin";
import { rustAstExtractor } from "./rustAst.ts";

export { rustAstExtractor };

export const langRustPlugin = Plugin.define({
  id: "repospec.lang.rust",
  async setup(ctx) {
    await ctx.language.transform((ed) => {
      ed.add({
        id: "rust",
        label: "Rust",
        extensions: [".rs"],
        extractor: rustAstExtractor,
      });
    });
    await ctx.extractor.transform((ed) => {
      ed.add(rustAstExtractor);
    });
  },
});

export default langRustPlugin;
