import { runGenerateRepoSpec, type GenerateResult } from "../../../src/effect/pipeline.ts";
import type { StorageMode } from "../../../src/schema.ts";
import { diffFactSets, loadRepoExtensions, queryFactsFromDb } from "./internal/loader.ts";
import { defineConfig, defineExtractor } from "./internal/toolkit.ts";

export { defineConfig, defineExtractor, diffFactSets, loadRepoExtensions, queryFactsFromDb };

export function scanRepo(
  repoDir: string,
  options?: { storageMode?: StorageMode; dbPath?: string },
): Promise<GenerateResult> {
  return runGenerateRepoSpec(repoDir, options?.storageMode ?? "artifact", options?.dbPath);
}

export type { GenerateResult } from "../../../src/effect/pipeline.ts";
export type { FactDiffResult, LoadedRepoExtensions } from "./internal/loader.ts";
export type {
  CustomExtractorDefinition,
  FactEdgeEmitInput,
  FactEmitInput,
  MetricEmitInput,
  RepoSpecConfig,
  ScanToolkit,
} from "./internal/toolkit.ts";
export type {
  ExtractorPlugin,
  FactEdgeRecord,
  FactRecord,
  GraphFragment,
  MetricRecord,
  ModuleCard,
  RepoContext,
  RepoSpecV4,
  SpecDiagnostic,
  SpecEdge,
  SpecNode,
  SpecRule,
  SqlInvariantResult,
  StorageMode,
  UnitDescriptor,
} from "../../../src/schema.ts";
