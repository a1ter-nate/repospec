import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fromPromise, type EffectPluginDefinition, type PromisePluginDefinition } from "@repospec/plugin";
import type { Scope } from "effect";
import type { NormalizedPlugin, PluginSource } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEffectPlugin(value: Record<string, unknown>): value is Record<string, unknown> & EffectPluginDefinition<Scope.Scope> {
  return typeof value.id === "string" && value.id.length > 0 && typeof value.effect === "function";
}

function isPromisePlugin(value: Record<string, unknown>): value is Record<string, unknown> & PromisePluginDefinition {
  return typeof value.id === "string" && value.id.length > 0 && typeof value.setup === "function";
}

export function normalizePluginDefinition(
  raw: unknown,
  source: PluginSource,
  guardedIds?: ReadonlySet<string>,
): NormalizedPlugin | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0) return null;
  const isGuarded = Boolean(raw.guarded) || Boolean(guardedIds?.has(raw.id));
  if (isEffectPlugin(raw)) {
    return {
      id: raw.id,
      guarded: isGuarded,
      source,
      effect: raw.effect,
    };
  }
  if (isPromisePlugin(raw)) {
    const adapted = fromPromise(raw);
    return {
      id: adapted.id,
      guarded: isGuarded,
      source,
      effect: adapted.effect,
    };
  }
  return null;
}

function resolvePackageEntry(pkgDir: string): string | null {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    const raw = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as {
      exports?: string | Record<string, unknown>;
      main?: string;
    };
    if (typeof raw.exports === "string") {
      return path.resolve(pkgDir, raw.exports);
    }
    if (isRecord(raw.exports)) {
      const rootExp = raw.exports["."];
      if (typeof rootExp === "string") return path.resolve(pkgDir, rootExp);
      if (isRecord(rootExp)) {
        const picked = rootExp.bun ?? rootExp.import ?? rootExp.default;
        if (typeof picked === "string") return path.resolve(pkgDir, picked);
      }
    }
    if (typeof raw.main === "string") {
      return path.resolve(pkgDir, raw.main);
    }
  }
  for (const fallback of ["index.ts", "src/index.ts", "index.mts"]) {
    const candidate = path.join(pkgDir, fallback);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function loadExternalPluginTarget(
  target: string,
  guardedIds?: ReadonlySet<string>,
): Promise<
  | { readonly ok: true; readonly plugin: NormalizedPlugin }
  | { readonly ok: false; readonly error: string; readonly source: PluginSource }
> {
  const absTarget = path.resolve(target);
  const isDir = fs.existsSync(absTarget) && fs.statSync(absTarget).isDirectory();
  const source: PluginSource = isDir
    ? { type: "package", target }
    : { type: "file", target };
  const entryPath = isDir ? resolvePackageEntry(absTarget) : absTarget;
  if (!entryPath || !fs.existsSync(entryPath)) {
    return { ok: false, error: `Cannot resolve plugin entry for "${target}"`, source };
  }
  try {
    const mtime = fs.statSync(entryPath).mtimeMs;
    const mod = (await import(`${pathToFileURL(entryPath).href}?mtime=${mtime}`)) as Record<string, unknown>;
    const candidate = mod.default ?? mod.plugin;
    const normalized = normalizePluginDefinition(candidate, source, guardedIds);
    if (!normalized) {
      return { ok: false, error: `Module "${target}" did not export a valid RepoSpec plugin`, source };
    }
    return { ok: true, plugin: normalized };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      source,
    };
  }
}
