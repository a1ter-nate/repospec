import fs from "node:fs";
import path from "node:path";
import { Plugin } from "@repospec/plugin";

function resolveCoreRulesDir(): string {
  const candidates = [
    path.resolve(import.meta.dir, "../../../../rules"),
    path.resolve(import.meta.dir, "../rules"),
    path.resolve(import.meta.dir, "../../rules"),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0] ?? "rules";
}

const CORE_RULES_DIR = resolveCoreRulesDir();

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
