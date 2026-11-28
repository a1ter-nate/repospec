import { Plugin } from "@repospec/plugin";
import { archExtractor } from "./arch.ts";
import { buildCrossDomainLinks } from "./crossLink.ts";
import { aggregateRepoSpecs } from "./federate.ts";
import { loadFederationInputs, type ExplicitTopologyLink } from "./federateDiff.ts";
import { gitEvolutionExtractor } from "./gitEvolution.ts";
import { parnasUncomplectExtractor } from "./parnasAndUncomplect.ts";

export { aggregateRepoSpecs, archExtractor, buildCrossDomainLinks, loadFederationInputs };
export type { ExplicitTopologyLink };

export const archPlugin = Plugin.define({
  id: "repospec.arch",
  async setup(ctx) {
    await ctx.extractor.transform((ed) => {
      ed.add(archExtractor);
      ed.add(gitEvolutionExtractor);
      ed.add(parnasUncomplectExtractor);
    });
    await ctx.linker.transform((ed) => {
      ed.add({
        id: "cross-domain.linker.v4",
        link: (repoCtx, fragments) => buildCrossDomainLinks(repoCtx, [...fragments]),
      });
    });
  },
});

export default archPlugin;
