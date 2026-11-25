import fs from "node:fs";
import path from "node:path";
import type { LayerPolicy, UnitArchetype } from "../../schema.ts";

export function workspaceSlug(name: string): string {
  return name.replace(/^@[^/]+\//, "");
}

export function workspaceNodeId(kind: "app" | "package" | "test_package" | "native_app" | "analyzer", name: string): string {
  const prefix =
    kind === "app"
      ? "arch:app"
      : kind === "native_app"
        ? "arch:native"
        : kind === "test_package"
          ? "arch:testpkg"
          : kind === "analyzer"
            ? "arch:analyzer"
            : "arch:pkg";
  return `${prefix}:${name}`;
}

function readTextSafe(absPath: string): string | null {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

function expandDirGlobs(rootDir: string, patterns: string[]): string[] {
  const dirs = new Set<string>();
  for (const raw of patterns) {
    const cleaned = raw.trim().replace(/^['"]|['"]$/g, "").replace(/\/+$/, "");
    if (!cleaned || cleaned.startsWith("!")) continue;
    if (cleaned.endsWith("/*")) {
      const base = cleaned.slice(0, -2);
      const absBase = path.join(rootDir, base);
      if (!fs.existsSync(absBase)) continue;
      for (const entry of fs.readdirSync(absBase, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          dirs.add(`${base}/${entry.name}`);
        }
      }
    } else if (cleaned.endsWith("/**")) {
      const base = cleaned.slice(0, -3);
      const absBase = path.join(rootDir, base);
      if (!fs.existsSync(absBase)) continue;
      for (const entry of fs.readdirSync(absBase, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const level1 = `${base}/${entry.name}`;
        dirs.add(level1);
        for (const sub of fs.readdirSync(path.join(rootDir, level1), { withFileTypes: true })) {
          if (sub.isDirectory() && !sub.name.startsWith(".")) {
            dirs.add(`${level1}/${sub.name}`);
          }
        }
      }
    } else if (fs.existsSync(path.join(rootDir, cleaned))) {
      dirs.add(cleaned);
    }
  }
  return Array.from(dirs).sort();
}

function parseCargoSection(text: string, sectionName: string): string {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\[${escaped}\\]\\s*$`, "m");
  const m = re.exec(text);
  if (!m) return "";
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const nextHeader = rest.search(/^\[/m);
  return nextHeader >= 0 ? rest.slice(0, nextHeader) : rest;
}

function readNpmWorkspaceGlobs(rootDir: string): string[] {
  const pnpmPath = path.join(rootDir, "pnpm-workspace.yaml");
  const pnpmText = readTextSafe(pnpmPath);
  if (pnpmText) {
    const globs: string[] = [];
    for (const line of pnpmText.split("\n")) {
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m?.[1]) globs.push(m[1].trim());
    }
    if (globs.length > 0) return globs;
  }
  const rootPkgText = readTextSafe(path.join(rootDir, "package.json"));
  if (rootPkgText) {
    try {
      const pkg = JSON.parse(rootPkgText) as { workspaces?: string[] | { packages?: string[] } };
      if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
      if (pkg.workspaces && Array.isArray(pkg.workspaces.packages)) return pkg.workspaces.packages;
    } catch {
      return [];
    }
  }
  return [];
}

function inferTsArchetypeAndPolicy(
  kind: "app" | "package" | "test_package" | "native_app",
  pkgDeps: Record<string, string>,
  relFiles: string[],
): { archetype: UnitArchetype; layerPolicy: LayerPolicy } {
  if (kind === "test_package") return { archetype: "test_suite", layerPolicy: "flat_library" };
  if (kind === "native_app") return { archetype: "frontend_app", layerPolicy: "layered_frontend" };
  if (kind === "package") return { archetype: "library_crate", layerPolicy: "flat_library" };

  const depNames = Object.keys(pkgDeps);
  const isFrontend =
    depNames.some((d) => ["react", "react-dom", "react-native", "next", "vite", "expo", "vue", "svelte"].includes(d)) ||
    relFiles.some((f) => f.endsWith(".tsx"));
  if (isFrontend) {
    return { archetype: "frontend_app", layerPolicy: "layered_frontend" };
  }
  const isHttpBackend =
    depNames.some((d) => ["express", "fastify", "hono", "koa", "@nestjs/core", "firebase-functions"].includes(d)) ||
    relFiles.some((f) => /(?:^|\/)(?:routes|controllers?|handlers?)\//.test(f));
  if (isHttpBackend) {
    return { archetype: "http_service", layerPolicy: "layered_backend" };
  }
  return { archetype: "cli_worker", layerPolicy: "flat_library" };
}

const TEMPLATE_OR_FIXTURE_PATH_RE = /^(?:templates|examples|fixtures|tests\/fixtures|corpus|reports)\//i;

function isTemplateOrFixturePath(relPath: string): boolean {
  return TEMPLATE_OR_FIXTURE_PATH_RE.test(relPath);
}

function parsePyprojectPackageName(text: string, fallback: string): string {
  const projMatch = text.match(/\[project\][\s\S]*?^\s*name\s*=\s*["']([^"']+)["']/m);
  if (projMatch?.[1]) return projMatch[1];
  const poetryMatch = text.match(/\[tool\.poetry\][\s\S]*?^\s*name\s*=\s*["']([^"']+)["']/m);
  return poetryMatch?.[1] ?? fallback;
}

export const UNIT_DISCOVERY_HELPERS = {
  readTextSafe,
  expandDirGlobs,
  parseCargoSection,
  readNpmWorkspaceGlobs,
  inferTsArchetypeAndPolicy,
  isTemplateOrFixturePath,
  parsePyprojectPackageName,
} as const;
