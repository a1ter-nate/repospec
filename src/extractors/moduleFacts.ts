import type { CapabilityTag, ExportedSymbol, ModuleDepth, ModuleRole } from "../schema.ts";

const CONFIG_FILE_RE =
  /(?:^|\/)(?:vite|vitest|jest|eslint|oxlint|tailwind|postcss|next|nuxt|svelte|astro|tsup|rollup|webpack|babel|playwright|cypress|drizzle|prisma|stryker|prettier|knip|biome|commitlint|lint-staged|jest\.config|vitest\.config|webpack\.config|babel\.config|metro|expo|capacitor|electron|tauri|turbo|uno|windi|rsbuild|rspack|farm|esbuild)\.config\.[a-zA-Z0-9]+$/i;

const GENERIC_CONFIG_RE = /(?:^|\/)[a-zA-Z0-9._-]+\.config\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;

const EXCLUDED_CODE_PREFIX_RE = /^(?:docs|doc|site|website|examples?|templates?|fixtures?|corpus|reports?|out|output|benchmarks?|benches|scripts\/fixtures)\//i;

const FS_RE =
  /\b(?:node:fs|fs\/promises|readFileSync|writeFileSync|readdirSync|mkdirSync|unlinkSync|std::fs|tokio::fs|File::open|File::create|System\.IO|File\.ReadAll|File\.WriteAll|pathlib|Path\(|open\([^)]*['"][rwa])|\bfrom\s+["'](?:node:)?fs(?:\/promises)?["']/;

const DB_RE =
  /\b(?:bun:sqlite|better-sqlite3|sqlite3|psycopg|sqlalchemy|drizzle-orm|prisma|typeorm|mongoose|sqlx::|diesel::|rusqlite|EntityFramework|DbContext|DbSet<|Npgsql|SqlConnection|Firestore|collectionGroup|\.collection\(|CREATE\s+TABLE|SELECT\s+.+\s+FROM\s+|INSERT\s+INTO\s+|UPDATE\s+\w+\s+SET\s+)/i;

const HTTP_RE =
  /\b(?:fetch\s*\(|axios|got\(|ky\.|undici|http\.createServer|https\.request|node:http|express\(|fastify\(|new\s+Hono|reqwest::|axum::|actix_web|hyper::|HttpClient|ControllerBase|MapGet|MapPost|FastAPI|APIRouter|Flask\(|requests\.(?:get|post|put|delete|patch)|httpx\.|aiohttp\.|urllib\.request)/;

const PROC_RE =
  /\b(?:node:child_process|execFileSync|execSync|spawnSync|spawn\(|Bun\.spawn|std::process::Command|tokio::process::Command|subprocess\.(?:run|Popen|check_output|call)|os\.system\(|System\.Diagnostics\.Process|ProcessStartInfo)/;

const ENV_RE =
  /\b(?:process\.env\b|Bun\.env\b|import\.meta\.env\b|std::env::var|env::var(?:_os)?\s*\(|os\.environ\b|os\.getenv\s*\(|GetEnvironmentVariable\s*\(|IConfiguration\b)/;

export function isExcludedCodePath(relFile: string): boolean {
  if (EXCLUDED_CODE_PREFIX_RE.test(relFile)) return true;
  if (CONFIG_FILE_RE.test(relFile) || GENERIC_CONFIG_RE.test(relFile)) return true;
  if (relFile.endsWith(".d.ts") || relFile.endsWith(".min.js")) return true;
  if (/(?:^|\/)(?:__pycache__|node_modules|dist|build|target|out|coverage)\//.test(relFile)) return true;
  return false;
}

export function detectCapabilities(text: string): CapabilityTag[] {
  const tags: CapabilityTag[] = [];
  if (FS_RE.test(text)) tags.push("FS");
  if (DB_RE.test(text)) tags.push("DB");
  if (HTTP_RE.test(text)) tags.push("HTTP");
  if (PROC_RE.test(text)) tags.push("PROC");
  if (ENV_RE.test(text)) tags.push("ENV");
  if (tags.length === 0) tags.push("PURE");
  return tags;
}

export function classifyOusterhoutDepth(
  lines: number,
  exportCount: number,
  allTypeExports: boolean,
): ModuleDepth {
  if (allTypeExports && exportCount > 0) return "contract";
  if (exportCount === 0) return lines >= 80 ? "deep" : "balanced";
  const ratio = lines / exportCount;
  if (ratio >= 65) return "deep";
  if (ratio >= 20) return "balanced";
  return "shallow";
}

export function inferModuleRole(params: {
  name: string;
  fanIn: number;
  fanOut: number;
  level: number;
  maxLevel: number;
  capabilities: CapabilityTag[];
  allTypeExports: boolean;
}): ModuleRole {
  const { name, fanIn, fanOut, level, maxLevel, capabilities, allTypeExports } = params;
  const lower = name.toLowerCase();
  if (fanIn === 0 && fanOut === 0) return "standalone";
  if (
    fanIn === 0 ||
    ["cli", "main", "index", "app", "server", "program", "routes", "endpoints", "controllers", "pages", "commands"].includes(lower)
  ) {
    if (fanIn === 0 && fanOut > 0) return "entry";
  }
  if (fanOut === 0 && fanIn > 0) return "foundation";
  if (allTypeExports || ["schema", "schemas", "types", "models", "contracts", "constants", "config", "errors"].includes(lower)) {
    if (level >= Math.max(1, maxLevel - 1)) return "foundation";
  }
  const hasIo = capabilities.some((c) => c === "DB" || c === "HTTP" || c === "PROC");
  if (
    hasIo &&
    /(?:db|data|store|repo|client|adapter|gateway|provider|persistence|infra|api|http|fetch|io|storage|cache)/i.test(lower)
  ) {
    return "adapter";
  }
  if (fanOut >= 3 && level <= 1) return "orchestrator";
  if (hasIo && fanOut <= 1) return "adapter";
  return "core";
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

export function extractRustPublicSymbols(prodText: string, relFile: string): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  const seen = new Set<string>();
  for (const m of prodText.matchAll(
    /^\s*pub(?:\(crate\))?\s+(?:async\s+)?(fn|struct|enum|trait|type|const)\s+([A-Za-z_][A-Za-z0-9_]*)/gm,
  )) {
    const rawKind = m[1];
    const name = m[2];
    if (!rawKind || !name || seen.has(name)) continue;
    seen.add(name);
    const kind: ExportedSymbol["kind"] =
      rawKind === "fn"
        ? "function"
        : rawKind === "struct" || rawKind === "enum" || rawKind === "trait"
          ? "class"
          : rawKind === "const"
            ? "const"
            : "type";
    out.push({
      name,
      kind,
      file: relFile,
      line: lineNumberAt(prodText, m.index ?? 0),
    });
    if (out.length >= 24) break;
  }
  return out;
}
