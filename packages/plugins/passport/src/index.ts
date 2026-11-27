import { Plugin } from "@repospec/plugin";
import {
  buildFilePassport,
  buildImpactReport,
  buildPrecedentsReport,
  buildUnitPassport,
  formatImpactAsGithubMarkdown,
} from "./passport.ts";

export {
  buildFilePassport,
  buildImpactReport,
  buildPrecedentsReport,
  buildUnitPassport,
  formatImpactAsGithubMarkdown,
};

export const passportPlugin = Plugin.define({
  id: "repospec.passport",
  async setup(ctx) {
    await ctx.query.transform((ed) => {
      ed.add({ id: "passport.file" });
      ed.add({ id: "passport.unit" });
      ed.add({ id: "passport.impact" });
      ed.add({ id: "passport.precedents" });
    });
  },
});

export default passportPlugin;
