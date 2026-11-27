import { Plugin } from "@repospec/plugin";
import { csharpAstExtractor } from "./csharpAst.ts";

export { csharpAstExtractor };

export const langCsharpPlugin = Plugin.define({
  id: "repospec.lang.csharp",
  async setup(ctx) {
    await ctx.language.transform((ed) => {
      ed.add({
        id: "csharp",
        label: "C#",
        extensions: [".cs"],
        extractor: csharpAstExtractor,
      });
    });
    await ctx.extractor.transform((ed) => {
      ed.add(csharpAstExtractor);
    });
  },
});

export default langCsharpPlugin;
