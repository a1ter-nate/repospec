import type { CanonicalLayer, NodeKind, NodeRole } from "../../schema.ts";
import { resolveCanonicalLayer } from "./layers.ts";

export const CONTAINER_DIRS = new Set([
  "modules",
  "features",
  "domains",
  "bounded-contexts",
  "slices",
  "areas",
]);

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

export function singularize(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith("us") || w.endsWith("ss") || w.endsWith("is")) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("s") && w.length > 3) return w.slice(0, -1);
  return w;
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
