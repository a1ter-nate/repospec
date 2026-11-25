import fs from "node:fs";
import path from "node:path";
import type { CanonicalLayer, LayerAxis, LayerPolicy, NodeKind, NodeRole, UnitArchetype, UnitDescriptor } from "./schema.ts";

export const CONTAINER_DIRS = new Set([
  "modules",
  "features",
  "domains",
  "bounded-contexts",
  "slices",
  "areas",
]);

const LAYER_TOKEN_TO_CANONICAL: Record<string, CanonicalLayer> = {
  routes: "transport",
  route: "transport",
  routepolicy: "transport",
  middleware: "transport",
  middlewares: "transport",
  controller: "transport",
  controllers: "transport",
  endpoint: "transport",
  endpoints: "transport",
  handler: "transport",
  handlers: "transport",
  graphql: "transport",
  resolvers: "transport",
  grpc: "transport",
  presentation: "transport",
  api: "transport",
  service: "orchestration",
  services: "orchestration",
  application: "orchestration",
  usecase: "orchestration",
  usecases: "orchestration",
  "use-cases": "orchestration",
  interactors: "orchestration",
  commands: "orchestration",
  queries: "orchestration",
  orchestrator: "orchestration",
  orchestrators: "orchestration",
  recommendation: "orchestration",
  domain: "domain",
  entities: "domain",
  model: "domain",
  models: "domain",
  aggregates: "domain",
  "value-objects": "domain",
  state_machines: "domain",
  machine: "domain",
  machines: "domain",
  policy: "domain",
  core: "domain",
  dao: "persistence",
  daos: "persistence",
  data: "persistence",
  db: "persistence",
  database: "persistence",
  repository: "persistence",
  repositories: "persistence",
  repo: "persistence",
  repos: "persistence",
  persistence: "persistence",
  infrastructure: "persistence",
  store: "persistence",
  stores: "persistence",
  prisma: "persistence",
  drizzle: "persistence",
  client: "integration",
  clients: "integration",
  billing: "integration",
  adapter: "integration",
  adapters: "integration",
  gateway: "integration",
  gateways: "integration",
  provider: "integration",
  providers: "integration",
  external: "integration",
  sdk: "integration",
  pages: "ui",
  screens: "ui",
  components: "ui",
  hooks: "ui",
  views: "ui",
  widgets: "ui",
  state: "ui",
  context: "ui",
  dashboard: "ui",
  loops: "runtime_loop",
  jobs: "runtime_loop",
  workers: "runtime_loop",
  worker: "runtime_loop",
  cron: "runtime_loop",
  scheduler: "runtime_loop",
  schedulers: "runtime_loop",
  consumers: "runtime_loop",
  analyzers: "analyzer",
  analyzer: "analyzer",
  scripts: "ops_script",
  bin: "ops_script",
  cli: "ops_script",
  tools: "ops_script",
  seed: "ops_script",
  codemods: "ops_script",
  examples: "ops_script",
  benches: "ops_script",
  util: "support",
  utils: "support",
  lib: "support",
  shared: "support",
  common: "support",
  config: "support",
  constants: "support",
  types: "support",
  schema: "support",
  schemas: "support",
  dto: "support",
  dtos: "support",
  errors: "support",
  error: "support",
  contracts: "support",
  tests: "tests",
  test: "tests",
  __tests__: "tests",
  testing: "tests",
  fuzz: "tests",
};

const NON_DOMAIN_BUCKETS = new Set([
  "v0",
  "v1",
  "v2",
  "v3",
  "admin",
  "common",
  "shared",
  "internal",
  "legacy",
  "policy",
  "index",
  "lib",
  "util",
  "utils",
  "standardize",
  "scripts",
  "types",
  "errors",
  "schemas",
  "dto",
  "page",
  "pages",
  "app",
  "(app)",
  "components",
  "hooks",
  "context",
  "state",
  "tests",
  "test",
  "unit",
  "integration",
  "examples",
  "benches",
]);

interface DefaultVendorsConfig {
  observability: string[];
  transports?: string[];
  sdks: Array<{ pattern: string; category: string; label?: string }>;
}

const DEFAULT_VENDORS_PATH = path.resolve(import.meta.dir, "../config/default-vendors.json");
const LOADED_VENDORS: {
  observability: string[];
  transports: Set<string>;
  sdks: Array<{ regex: RegExp; category: string; label: string }>;
} = (() => {
  try {
    const raw = JSON.parse(fs.readFileSync(DEFAULT_VENDORS_PATH, "utf8")) as DefaultVendorsConfig;
    return {
      observability: (raw.observability ?? []).map((s) => s.toLowerCase()),
      transports: new Set((raw.transports ?? []).map((s) => s.toLowerCase())),
      sdks: (raw.sdks ?? []).map((s) => ({
        regex: new RegExp(s.pattern, "i"),
        category: s.category,
        label: s.label ?? s.category,
      })),
    };
  } catch {
    return { observability: [], transports: new Set<string>(), sdks: [] };
  }
})();

export interface LayerSemantics {
  axis: LayerAxis;
  rank: number;
  laneId: string;
  laneLabel: string;
}

export function resolveLayerSemantics(rawLayer: string, canonicalLayer: CanonicalLayer): LayerSemantics {
  const lower = rawLayer.toLowerCase();
  if (canonicalLayer === "transport") {
    if (lower === "controller" || lower === "controllers" || lower === "handler" || lower === "handlers") {
      return { axis: "pipeline", rank: 1, laneId: "controllers", laneLabel: "Controllers" };
    }
    return { axis: "pipeline", rank: 0, laneId: "entry", laneLabel: "Entry & Routes" };
  }
  if (canonicalLayer === "ui") {
    if (["pages", "screens", "views", "dashboard", "app"].includes(lower)) {
      return { axis: "pipeline", rank: 0, laneId: "entry", laneLabel: "Pages & Views" };
    }
    return { axis: "pipeline", rank: 1, laneId: "controllers", laneLabel: "Components & State" };
  }
  if (canonicalLayer === "orchestration" || canonicalLayer === "runtime_loop") {
    return { axis: "pipeline", rank: 2, laneId: "logic", laneLabel: "Orchestration" };
  }
  if (canonicalLayer === "persistence") {
    return { axis: "pipeline", rank: 3, laneId: "adapters", laneLabel: "Persistence & Integration" };
  }
  if (canonicalLayer === "integration") {
    return { axis: "integration", rank: 3, laneId: "adapters", laneLabel: "Persistence & Integration" };
  }
  return { axis: "foundation", rank: 5, laneId: "lateral", laneLabel: "Shared Foundation" };
}

export interface ExternalPackageClassification {
  kind: "service" | "transport" | "observability";
  category: string;
  label: string;
}

function normalizeVendorLabel(pkg: string): string {
  const withoutScope = pkg.replace(/^@/, "");
  const parts = withoutScope.split("/");
  const leaf = parts[parts.length - 1] ?? pkg;
  const cleaned = leaf
    .replace(/^client[-_.]/i, "")
    .replace(/(?:[-_.](?:js|ts|node|sdk|client|services|api|rs))+$/i, "");
  const effective = cleaned.length >= 2 ? cleaned : leaf;
  return effective
    .split(/[-_.]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function classifyExternalPackage(pkg: string): ExternalPackageClassification | null {
  const lower = pkg.toLowerCase();
  for (const obs of LOADED_VENDORS.observability) {
    if (lower === obs || lower.startsWith(obs)) {
      const base = pkg.replace(/^@/, "").split("/")[0] ?? pkg;
      return {
        kind: "observability",
        category: "observability",
        label: base.charAt(0).toUpperCase() + base.slice(1),
      };
    }
  }
  if (LOADED_VENDORS.transports.has(lower)) {
    return {
      kind: "transport",
      category: "http_client",
      label: normalizeVendorLabel(pkg),
    };
  }
  for (const rule of LOADED_VENDORS.sdks) {
    if (rule.regex.test(pkg)) {
      return {
        kind: "service",
        category: rule.category,
        label: normalizeVendorLabel(pkg) || rule.label,
      };
    }
  }
  return null;
}

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

export function singularize(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith("us") || w.endsWith("ss") || w.endsWith("is")) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("s") && w.length > 3) return w.slice(0, -1);
  return w;
}

export function resolveCanonicalLayer(rawLayer: string): CanonicalLayer {
  const normalized = rawLayer.toLowerCase().replace(/^@/, "");
  return LAYER_TOKEN_TO_CANONICAL[normalized] ?? "unclassified";
}

export function classifyVendorPackage(pkg: string): string | null {
  return classifyExternalPackage(pkg)?.category ?? null;
}

export function vendorLabelForPackage(pkg: string): { label: string; category: string } | null {
  const info = classifyExternalPackage(pkg);
  if (!info) return null;
  return { label: info.label, category: info.category };
}

export function isNonDomainBucket(token: string): boolean {
  const lower = token.toLowerCase();
  return !lower || lower.startsWith("(") || lower.startsWith("[") || lower.startsWith("_") || NON_DOMAIN_BUCKETS.has(lower);
}

export function resolveFeatureOrLayerPath(
  relFile: string,
  unitDir: string,
): { rawLayer: string; canonicalLayer: CanonicalLayer; inferredDomain: string | null } {
  let inner = unitDir !== "." && relFile.startsWith(`${unitDir}/`) ? relFile.slice(unitDir.length + 1) : relFile;
  inner = inner.replace(/^(?:functions|src|app)\//, "");
  const parts = inner.split("/");
  if (parts.length <= 1) {
    return { rawLayer: "root", canonicalLayer: "unclassified", inferredDomain: null };
  }

  const first = (parts[0] ?? "").toLowerCase();
  if (CONTAINER_DIRS.has(first) && parts.length >= 3) {
    const candidateDomain = parts[1] ?? "";
    const inferredDomain = isNonDomainBucket(candidateDomain) ? null : singularize(candidateDomain);
    for (let i = 2; i < parts.length - 1; i += 1) {
      const seg = parts[i] ?? "";
      const canonical = resolveCanonicalLayer(seg);
      if (canonical !== "unclassified") {
        return { rawLayer: seg, canonicalLayer: canonical, inferredDomain };
      }
    }
    const baseName = parts[parts.length - 1] ?? "";
    const suffixMatch = baseName.match(/\.([a-zA-Z0-9_-]+)\.(?:ts|tsx|mts|cts|js|jsx|cs|rs)$/);
    if (suffixMatch?.[1]) {
      const canonical = resolveCanonicalLayer(suffixMatch[1]);
      if (canonical !== "unclassified") {
        return { rawLayer: suffixMatch[1], canonicalLayer: canonical, inferredDomain };
      }
    }
    const rawLayer = parts[2] ?? "root";
    return { rawLayer, canonicalLayer: resolveCanonicalLayer(rawLayer), inferredDomain };
  }

  const rawLayer = parts[0] ?? "root";
  const canonicalLayer = resolveCanonicalLayer(rawLayer);
  let inferredDomain: string | null = null;
  if (parts.length >= 3) {
    const candidate = parts[1] ?? "";
    if (!isNonDomainBucket(candidate) && canonicalLayer !== "ops_script" && canonicalLayer !== "tests") {
      inferredDomain = singularize(candidate);
    }
  }
  return { rawLayer, canonicalLayer, inferredDomain };
}

export function inferNodeRole(kind: NodeKind, meta: Record<string, unknown>, group?: string): NodeRole {
  if (kind === "native_app") return "client";
  if (kind === "app") {
    const g = (group ?? "").toLowerCase();
    const archetype = typeof meta.archetype === "string" ? meta.archetype : "";
    if (archetype === "frontend_app" || g.includes("frontend")) return "client";
    return "service";
  }
  if (kind === "package") return "library";
  if (kind === "analyzer") return "analyzer";
  if (kind === "datastore") return "datastore";
  if (kind === "external_service") return "external";
  if (kind === "test_package" || kind === "test_suite") return "test";
  if (kind === "workflow" || kind === "ci_job") return "ci";
  if (kind === "iac_resource" || kind === "iac_container" || kind === "iac_datastore_rule") {
    if (meta.plane === "network") return "ingress";
    return "iac";
  }
  if (kind === "code_layer") return "layer";
  if (kind === "domain_area") return "domain";
  return "rule";
}

export function canonicalizeGitRemote(rawUrl: string | null | undefined): string | null {
  const trimmed = (rawUrl ?? "").trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith(".") || trimmed.startsWith("file://")) {
    return null;
  }

  let host = "";
  let pathname = "";
  const scpMatch = trimmed.match(/^(?:[^@/\s]+@)?([a-zA-Z0-9._-]+):([a-zA-Z0-9._/-]+)$/);
  if (scpMatch && !trimmed.includes("://")) {
    host = scpMatch[1] ?? "";
    pathname = scpMatch[2] ?? "";
  } else {
    try {
      const parsed = new URL(trimmed);
      if (!["http:", "https:", "ssh:", "git:"].includes(parsed.protocol)) return null;
      host = parsed.hostname;
      pathname = parsed.pathname;
    } catch {
      return null;
    }
  }

  host = host.toLowerCase().replace(/^(github\.com|gitlab\.com|bitbucket\.org)-.+$/, "$1");
  pathname = pathname.replace(/^\/+/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!host || !pathname || !host.includes(".")) return null;
  return `https://${host}/${pathname}`;
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

export function discoverUnits(rootDir: string, allFiles: string[]): UnitDescriptor[] {
  const units = new Map<string, UnitDescriptor>();

  if (allFiles.includes("Cargo.toml")) {
    const rootCargo = readTextSafe(path.join(rootDir, "Cargo.toml")) ?? "";
    const wsSection = parseCargoSection(rootCargo, "workspace");
    const membersMatch = wsSection.match(/members\s*=\s*\[([\s\S]*?)\]/);
    const memberPatterns = membersMatch?.[1]
      ? Array.from(membersMatch[1].matchAll(/"([^"]+)"/g))
          .map((m) => m[1] ?? "")
          .filter(Boolean)
      : [];
    const crateDirs = memberPatterns.length > 0 ? expandDirGlobs(rootDir, memberPatterns) : ["."];
    if (fs.existsSync(path.join(rootDir, "fuzz/Cargo.toml"))) crateDirs.push("fuzz");

    for (const relDir of Array.from(new Set(crateDirs)).sort()) {
      const cargoRel = relDir === "." ? "Cargo.toml" : `${relDir}/Cargo.toml`;
      const cargoText = readTextSafe(path.join(rootDir, cargoRel));
      if (!cargoText) continue;
      const pkgSection = parseCargoSection(cargoText, "package");
      const nameMatch = pkgSection.match(/^\s*name\s*=\s*"([^"]+)"/m);
      const crateName = nameMatch?.[1] ?? path.posix.basename(relDir);
      const binDir = path.join(rootDir, relDir, "src/bin");
      const hasBin =
        /\[\[bin\]\]/.test(cargoText) ||
        fs.existsSync(path.join(rootDir, relDir, "src/main.rs")) ||
        (fs.existsSync(binDir) && fs.readdirSync(binDir).some((f) => f.endsWith(".rs")));
      const isFuzzOrTest = relDir === "fuzz" || crateName.includes("fuzz") || crateName.includes("qa");
      const kind: "app" | "package" | "test_package" = isFuzzOrTest ? "test_package" : hasBin ? "app" : "package";
      const id = workspaceNodeId(kind, crateName);
      const binNames = Array.from(cargoText.matchAll(/\[\[bin\]\][\s\S]*?name\s*=\s*"([^"]+)"/g))
        .map((m) => m[1] ?? "")
        .filter(Boolean);

      const crateFiles = allFiles.filter((f) => (relDir === "." ? f.endsWith(".rs") : f.startsWith(`${relDir}/`) && f.endsWith(".rs")));
      const hasAxumOrHttp = /\b(?:axum|actix-web|warp|rocket|tonic)\b/.test(cargoText);
      const hasExplicitLayerDirs = crateFiles.some((f) => /\/src\/(?:routes|handlers|db|repositories|persistence|dao|services)\//.test(f));

      const archetype: UnitArchetype = isFuzzOrTest
        ? "test_suite"
        : hasAxumOrHttp
          ? "http_service"
          : hasBin
            ? "cli_worker"
            : "library_crate";
      const layerPolicy: LayerPolicy = hasExplicitLayerDirs ? "layered_backend" : "flat_library";

      units.set(id, {
        id,
        name: crateName,
        slug: crateName,
        dir: relDir,
        absDir: path.resolve(rootDir, relDir),
        manifestFile: cargoRel,
        ecosystem: "rust",
        kind,
        archetype,
        layerPolicy,
        external: false,
        entryFile: crateFiles.find((f) => f.endsWith("/src/lib.rs") || f.endsWith("/src/main.rs")) ?? null,
        targetFramework: null,
        bins: binNames,
      });
    }
  }

  const csprojPaths = new Set<string>(allFiles.filter((f) => f.endsWith(".csproj")));
  for (const slnx of allFiles.filter((f) => f.endsWith(".slnx"))) {
    const text = readTextSafe(path.join(rootDir, slnx));
    if (!text) continue;
    for (const m of text.matchAll(/<Project\s+Path="([^"]+\.csproj)"/gi)) {
      if (m[1]) {
        const norm = m[1].replace(/\\/g, "/");
        if (fs.existsSync(path.resolve(rootDir, path.posix.dirname(slnx), norm))) {
          csprojPaths.add(norm);
        }
      }
    }
  }
  for (const sln of allFiles.filter((f) => f.endsWith(".sln"))) {
    const text = readTextSafe(path.join(rootDir, sln));
    if (!text) continue;
    for (const m of text.matchAll(/,\s*"([^"]+\.csproj)"/gi)) {
      if (m[1]) {
        const norm = m[1].replace(/\\/g, "/");
        if (fs.existsSync(path.resolve(rootDir, path.posix.dirname(sln), norm))) {
          csprojPaths.add(norm);
        }
      }
    }
  }

  const dirPropsText = readTextSafe(path.join(rootDir, "Directory.Build.props"));
  const sharedTfm = dirPropsText?.match(/<TargetFramework>([^<]+)<\/TargetFramework>/i)?.[1]?.trim() ?? null;
  if (dirPropsText) {
    for (const m of dirPropsText.matchAll(/<ProjectReference\s+[^>]*Include="([^"]+\.csproj)"[^>]*>/gi)) {
      if (m[0] && m[1] && /OutputItemType="Analyzer"/i.test(m[0])) {
        const rawRef = m[1].replace(/\$\(MSBuildThisFileDirectory\)/g, "").replace(/\\/g, "/");
        const candidates = [
          path.resolve(rootDir, rawRef),
          ...Array.from(csprojPaths).map((cp) => path.resolve(path.dirname(path.resolve(rootDir, cp)), rawRef)),
        ];
        const foundAbs = candidates.find((c) => fs.existsSync(c));
        if (foundAbs) {
          csprojPaths.add(path.relative(rootDir, foundAbs).replace(/\\/g, "/"));
        }
      }
    }
  }

  const csUnitsTemp: UnitDescriptor[] = [];
  for (const relCsproj of Array.from(csprojPaths).sort()) {
    const absCsproj = path.resolve(rootDir, relCsproj);
    const text = readTextSafe(absCsproj);
    if (!text) continue;
    const asmMatch = text.match(/<AssemblyName>([^<]+)<\/AssemblyName>/i);
    const projName = asmMatch?.[1]?.trim() ?? path.basename(relCsproj, ".csproj");
    const isAnalyzer = /<IsRoslynComponent>\s*true\s*<\/IsRoslynComponent>/i.test(text);
    const isTest = /Microsoft\.NET\.Test\.Sdk|xunit|nunit|MSTest/i.test(text) || /\.Tests?$/i.test(projName);
    const isWeb = /Sdk="Microsoft\.NET\.Sdk\.Web"/i.test(text);
    const isExe = /<OutputType>\s*(?:Exe|WinExe)\s*<\/OutputType>/i.test(text) || isWeb;
    const kind: "app" | "package" | "test_package" | "analyzer" = isAnalyzer
      ? "analyzer"
      : isTest
        ? "test_package"
        : isExe
          ? "app"
          : "package";
    const id = workspaceNodeId(kind, projName);
    const relDir = path.posix.dirname(relCsproj.replace(/\\/g, "/"));
    const tfm = text.match(/<TargetFramework>([^<]+)<\/TargetFramework>/i)?.[1]?.trim() ?? sharedTfm;
    const archetype: UnitArchetype = isAnalyzer
      ? "analyzer_plugin"
      : isTest
        ? "test_suite"
        : isWeb
          ? "http_service"
          : isExe
            ? "cli_worker"
            : "library_crate";

    csUnitsTemp.push({
      id,
      name: projName,
      slug: projName,
      dir: relDir,
      absDir: path.dirname(absCsproj),
      manifestFile: relCsproj.replace(/\\/g, "/"),
      ecosystem: "csharp",
      kind,
      archetype,
      layerPolicy: "flat_library",
      external: relCsproj.startsWith(".."),
      entryFile: null,
      targetFramework: tfm,
      bins: [],
    });
  }

  const hasCleanArchProjects =
    csUnitsTemp.some((u) => /\.Domain$/i.test(u.name)) &&
    csUnitsTemp.some((u) => /\.(?:Application|Infrastructure|Api|Persistence)$/i.test(u.name));
  for (const u of csUnitsTemp) {
    if (hasCleanArchProjects && u.kind !== "test_package" && u.kind !== "analyzer") {
      u.layerPolicy = "layered_clean_arch";
    }
    units.set(u.id, u);
  }

  if (
    allFiles.some((f) => f === "package.json" || f.endsWith("/package.json")) ||
    allFiles.includes("pnpm-workspace.yaml")
  ) {
    const globs = readNpmWorkspaceGlobs(rootDir);
    const candidateDirs = new Set<string>(
      globs.length > 0 ? expandDirGlobs(rootDir, globs) : expandDirGlobs(rootDir, ["apps/*", "packages/*", "tests/*"]),
    );
    for (const rel of allFiles) {
      if (rel.endsWith("/package.json")) {
        const d = path.posix.dirname(rel);
        const depth = d.split("/").length;
        if (depth <= 3 && ["apps", "packages", "tests"].includes(d.split("/")[0] ?? "")) {
          candidateDirs.add(d);
        }
      }
    }

    for (const relDir of Array.from(candidateDirs).sort()) {
      const absDir = path.join(rootDir, relDir);
      if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) continue;
      const pkgPath = path.join(absDir, "package.json");
      if (fs.existsSync(path.join(absDir, "Cargo.toml")) && !fs.existsSync(pkgPath)) continue;

      const topDir = relDir.split("/")[0] ?? "packages";
      const relFiles = allFiles.filter((f) => f.startsWith(`${relDir}/`));
      const pkgText = readTextSafe(pkgPath);

      if (pkgText) {
        try {
          const pkg = JSON.parse(pkgText) as {
            name?: string;
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
          };
          if (!pkg.name) continue;
          const kind: "app" | "package" | "test_package" =
            topDir === "apps" ? "app" : topDir === "tests" ? "test_package" : "package";
          const id = workspaceNodeId(kind, pkg.name);
          const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
          const { archetype, layerPolicy } = inferTsArchetypeAndPolicy(kind, allDeps, relFiles);
          const entryCandidates = [
            `${relDir}/src/index.ts`,
            `${relDir}/src/index.tsx`,
            `${relDir}/index.ts`,
            `${relDir}/functions/index.ts`,
          ];
          const entryFile = entryCandidates.find((c) => allFiles.includes(c)) ?? null;
          units.set(id, {
            id,
            name: pkg.name,
            slug: workspaceSlug(pkg.name),
            dir: relDir,
            absDir,
            manifestFile: `${relDir}/package.json`,
            ecosystem: "typescript",
            kind,
            archetype,
            layerPolicy,
            external: false,
            entryFile,
            targetFramework: null,
            bins: [],
          });
        } catch {
          continue;
        }
      } else if ((topDir === "apps" || topDir === "tests") && relFiles.length > 0) {
        const hasSwift = relFiles.some((f) => /\.(swift|pbxproj)$/.test(f));
        const hasKotlin = relFiles.some((f) => /\.(kt|gradle|gradle\.kts)$/.test(f));
        const isNative = topDir === "apps" && (hasSwift || hasKotlin);
        const kind: "app" | "test_package" | "native_app" = isNative ? "native_app" : topDir === "tests" ? "test_package" : "app";
        const baseName = path.posix.basename(relDir);
        const id = workspaceNodeId(kind, baseName);
        units.set(id, {
          id,
          name: baseName,
          slug: baseName,
          dir: relDir,
          absDir,
          manifestFile: relDir,
          ecosystem: isNative ? "native" : "typescript",
          kind,
          archetype: isNative ? "frontend_app" : kind === "test_package" ? "test_suite" : "cli_worker",
          layerPolicy: isNative ? "layered_frontend" : "flat_library",
          external: false,
          entryFile: null,
          targetFramework: null,
          bins: [],
        });
      }
    }
  }

  return Array.from(units.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveUnitForFile(relFile: string, units: UnitDescriptor[]): UnitDescriptor | null {
  const sorted = [...units].filter((u) => !u.external && u.dir !== ".").sort((a, b) => b.dir.length - a.dir.length);
  for (const u of sorted) {
    if (relFile === u.dir || relFile.startsWith(`${u.dir}/`)) return u;
  }
  return units.find((u) => u.dir === ".") ?? null;
}
