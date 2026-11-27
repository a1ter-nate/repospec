#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (typeof globalThis.Bun === "undefined") {
  process.stderr.write("RepoSpec requires Bun >= 1.2 (https://bun.sh)\n");
  process.exit(1);
}

const binDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(binDir, "..");
const devEntry = path.join(pkgRoot, "src", "cli.ts");
const distEntry = path.join(pkgRoot, "dist", "cli.mjs");
const target = fs.existsSync(devEntry) ? devEntry : distEntry;

if (!fs.existsSync(target)) {
  process.stderr.write(`RepoSpec entrypoint missing (${target}). Run 'bun run build' first.\n`);
  process.exit(1);
}

const mod = await import(pathToFileURL(target).href);
if (typeof mod.runCliMain === "function") {
  mod.runCliMain();
}
