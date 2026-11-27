import fs from "node:fs";
import path from "node:path";
import type { CanonicalLayer, LayerAxis } from "../schema.ts";

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
  cli: "transport",
  tools: "ops_script",
  hack: "ops_script",
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

interface DefaultVendorsConfig {
  observability: string[];
  transports?: string[];
  sdks: Array<{ pattern: string; category: string; label?: string }>;
}

function resolveDefaultVendorsPath(): string {
  const candidates = [
    path.resolve(import.meta.dir, "../../../../config/default-vendors.json"),
    path.resolve(import.meta.dir, "../config/default-vendors.json"),
    path.resolve(import.meta.dir, "../../config/default-vendors.json"),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0] ?? "config/default-vendors.json";
}

const DEFAULT_VENDORS_PATH = resolveDefaultVendorsPath();
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
