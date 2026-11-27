import { Plugin, type RepoSpecV4 } from "@repospec/plugin";
import { generateIdsModule, generateSqliteSdkModule } from "./sdkGen.ts";

export { generateIdsModule, generateSqliteSdkModule };

export const sdkGenPlugin = Plugin.define({
  id: "repospec.sdk-gen",
  async setup(ctx) {
    await ctx.command.transform((ed) => {
      ed.add({
        id: "sdk.ids",
        description: "Generate typed repospec.ids.ts module",
        run: (args) => generateIdsModule(args.spec as RepoSpecV4, String(args.digest ?? "")),
      });
      ed.add({
        id: "sdk.sqlite",
        description: "Generate typed repospec.sdk.ts module",
        run: () => generateSqliteSdkModule(),
      });
    });
  },
});

export default sdkGenPlugin;
