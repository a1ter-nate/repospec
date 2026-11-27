import path from "node:path";
import { Plugin } from "@repospec/plugin";

const CORE_RULES_DIR = path.resolve(import.meta.dir, "../../../../rules");

export const corePolicyPlugin = Plugin.define({
  id: "repospec.policy.core",
  guarded: true,
  async setup(ctx) {
    await ctx.rule.transform((ed) => {
      ed.add({
        id: "repospec.rules.builtin",
        dir: CORE_RULES_DIR,
      });
    });
  },
});
