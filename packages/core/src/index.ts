import type { StorageMode } from "@repospec/plugin";
import { buildCanonicalSpec, diffSpecs, hashSpec, mergeFragments, serializeSpec } from "./canonicalize.ts";
import { discoverRepo } from "./discover.ts";
import { runGenerateRepoSpec, type GenerateResult } from "./effect/pipeline.ts";
import {
  createAndPopulateIndexDb,
  NAMED_QUERIES,
  projectInvariantsToGraph,
  queryEntityOwnership,
  querySurfaces,
  queryVerificationCoverage,
  runSqlInvariants,
  storeDigestInDb,
} from "./indexDb.ts";
import { diffFactSets, loadRepoExtensions, queryFactsFromDb } from "./internal/loader.ts";
import { defineConfig, defineExtractor } from "./internal/toolkit.ts";
import { createPluginHost, PluginHost } from "./plugin/host.ts";
import { create as createState, State } from "./state.ts";

export {
  buildCanonicalSpec,
  createAndPopulateIndexDb,
  createPluginHost,
  createState,
  defineConfig,
  defineExtractor,
  diffFactSets,
  diffSpecs,
  discoverRepo,
  hashSpec,
  loadRepoExtensions,
  mergeFragments,
  NAMED_QUERIES,
  PluginHost,
  projectInvariantsToGraph,
  queryEntityOwnership,
  queryFactsFromDb,
  querySurfaces,
  queryVerificationCoverage,
  runGenerateRepoSpec,
  runSqlInvariants,
  serializeSpec,
  State,
  storeDigestInDb,
};

export function scanRepo(
  repoDir: string,
  options?: { storageMode?: StorageMode; dbPath?: string },
): Promise<GenerateResult> {
  return runGenerateRepoSpec(repoDir, options?.storageMode ?? "artifact", options?.dbPath);
}

export type { GenerateResult } from "./effect/pipeline.ts";
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
  PluginCheckResult,
  PluginHostInstance,
  PluginHostOptions,
  PluginOperation,
  PluginScanResult,
  PluginStatusEntry,
} from "./plugin/types.ts";
export type { StateInstance, StateOptions } from "./state.ts";
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
} from "@repospec/plugin";
