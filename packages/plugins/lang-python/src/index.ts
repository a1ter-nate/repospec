import { Plugin } from "@repospec/plugin";
import { pythonAstExtractor } from "./pythonAst.ts";

export { pythonAstExtractor };

export const langPythonPlugin = Plugin.define({
  id: "repospec.lang.python",
  async setup(ctx) {
    await ctx.language.transform((ed) => {
      ed.add({
        id: "python",
        label: "Python",
        extensions: [".py"],
        extractor: pythonAstExtractor,
      });
    });
    await ctx.extractor.transform((ed) => {
      ed.add(pythonAstExtractor);
    });
  },
});

export default langPythonPlugin;
