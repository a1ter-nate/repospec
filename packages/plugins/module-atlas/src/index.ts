import { Plugin } from "@repospec/plugin";
import { buildAllDiagrams, buildStaticTraces, resolveEvidenceAnchors } from "./layout.ts";
import { buildModuleArchitecture } from "./moduleGraph.ts";
import {
  buildLanesForLevels,
  computeTopologicalLevels,
  peelUnitModulePaths,
  summarizeModuleMetadata,
  type TopologicalAnalysis,
} from "./topoLevels.ts";

export {
  buildAllDiagrams,
  buildLanesForLevels,
  buildModuleArchitecture,
  buildStaticTraces,
  computeTopologicalLevels,
  peelUnitModulePaths,
  resolveEvidenceAnchors,
  summarizeModuleMetadata,
};
export type { TopologicalAnalysis };

export const moduleAtlasPlugin = Plugin.define({
  id: "repospec.module-atlas",
  async setup(ctx) {
    await ctx.diagram.transform((ed) => {
      ed.add({
        id: "module-atlas.v5",
        buildModuleArchitecture,
        buildAllDiagrams,
        resolveEvidenceAnchors,
        buildStaticTraces,
      });
    });
  },
});

export default moduleAtlasPlugin;
