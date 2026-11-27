#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { repospecCommand } from "@repospec/cli";
import { runGenerateRepoSpec, type GenerateResult } from "@repospec/core";
import { RepospecLive } from "@repospec/core/effect";
import type { StorageMode } from "@repospec/plugin";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";

function readPackageVersion(): string {
  const candidates = [
    path.resolve(import.meta.dir, "../package.json"),
    path.resolve(import.meta.dir, "../../package.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as { version?: string };
      if (typeof parsed.version === "string" && parsed.version.length > 0) return parsed.version;
    } catch {
      continue;
    }
  }
  return "5.0.1";
}

export function generateRepoSpec(
  repoDir: string,
  storageMode: StorageMode = "artifact",
  dbOutPath?: string,
): Promise<GenerateResult> {
  return runGenerateRepoSpec(repoDir, storageMode, dbOutPath);
}

export function runCliMain(): void {
  const cliLayer = Layer.mergeAll(BunServices.layer, RepospecLive);
  const program = Command.run(repospecCommand, { version: readPackageVersion() }).pipe(Effect.provide(cliLayer));
  BunRuntime.runMain(program);
}

if (import.meta.main) {
  runCliMain();
}
