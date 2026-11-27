import { Plugin } from "@repospec/plugin";
import { codeAstExtractor } from "./codeAst.ts";

export { codeAstExtractor };

export const langTypescriptPlugin = Plugin.define({
  id: "repospec.lang.typescript",
  async setup(ctx) {
    await ctx.language.transform((ed) => {
      ed.add({
        id: "typescript",
        label: "TypeScript / JavaScript",
        extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
        extractor: codeAstExtractor,
      });
    });
    await ctx.extractor.transform((ed) => {
      ed.add(codeAstExtractor);
    });
  },
});

export default langTypescriptPlugin;
