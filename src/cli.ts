#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { archExtractor } from "./extractors/arch.ts";
import { ciExtractor } from "./extractors/ci.ts";
import { codeAstExtractor } from "./extractors/codeAst.ts";
import { csharpAstExtractor } from "./extractors/csharpAst.ts";
import { iacExtractor } from "./extractors/iac.ts";
import { pythonAstExtractor } from "./extractors/pythonAst.ts";
import { rustAstExtractor } from "./extractors/rustAst.ts";
import { surfacesAndGovernanceExtractor } from "./extractors/surfacesAndGovernance.ts";
import { testingAndRulesExtractor } from "./extractors/testingAndRules.ts";
import { repospecCommand } from "./effect/cliApp.ts";
import { runGenerateRepoSpec, type GenerateResult } from "./effect/pipeline.ts";
import { RepospecLive } from "./effect/services.ts";
import type { ExtractorPlugin, StorageMode } from "./schema.ts";

export const DEFAULT_EXTRACTORS: ExtractorPlugin[] = [
  archExtractor,
  codeAstExtractor,
  pythonAstExtractor,
  rustAstExtractor,
  csharpAstExtractor,
  ciExtractor,
  testingAndRulesExtractor,
  iacExtractor,
  surfacesAndGovernanceExtractor,
];

export function generateRepoSpec(
  repoDir: string,
  storageMode: StorageMode = "artifact",
  dbOutPath?: string,
): Promise<GenerateResult> {
  return runGenerateRepoSpec(repoDir, storageMode, dbOutPath);
}

if (import.meta.main) {
  const cliLayer = Layer.mergeAll(BunServices.layer, RepospecLive);
  const program = Command.run(repospecCommand, { version: "5.0.7" }).pipe(Effect.provide(cliLayer));
  BunRuntime.runMain(program);
}
