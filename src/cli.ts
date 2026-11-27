#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { repospecCommand } from "@repospec/cli";
import { runGenerateRepoSpec, type GenerateResult } from "@repospec/core";
import { RepospecLive } from "@repospec/core/effect";
import type { StorageMode } from "@repospec/plugin";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";

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
