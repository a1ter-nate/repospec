import { Plugin } from "@repospec/plugin";
import { defaultShowMe, runShowMeBundle } from "@repospec/show-me";

export { defaultShowMe, runShowMeBundle };

export const showMePlugin = Plugin.define({
  id: "repospec.show-me",
  async setup(ctx) {
    await ctx.showMe.transform((ed) => {
      ed.addTriage("repospec.show-me.default", (_hookCtx, current) => current);
    });
    await ctx.command.transform((ed) => {
      ed.add({ id: "show-me", description: "Generate priority-ranked architectural diff screenshots" });
    });
  },
});

export default showMePlugin;
