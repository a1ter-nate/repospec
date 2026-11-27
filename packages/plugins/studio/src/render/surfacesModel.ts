import type { RepoSpecV4 } from "@repospec/plugin";
import type { DrilldownIndex } from "../studio/drilldown.ts";
import type { EntityFieldLifecycle } from "@repospec/flows";

export interface SurfaceEndpointItem {
  id: string;
  unit: string;
  method: string;
  path: string;
  guardClass: "guarded" | "public" | "unknown";
  guardName: string;
  guardExpr: string | null;
  source: "openapi" | "ast";
  resolution: string;
  file: string;
  line: number;
  hasSource: boolean;
  prefix: string;
  subPrefix: string;
  isWrite: boolean;
}

export interface SurfaceEntityItem {
  id: string;
  entity: string;
  datastore: string;
  totalRefs: number;
  domains: string[];
  layers: string[];
  sampleFiles: string[];
  declared: boolean;
  authorizedShared: boolean;
  fkCount: number;
  hasTenancyKey: boolean;
  crossDomain: boolean;
  noContract: boolean;
  noDomain: boolean;
  flagged: boolean;
  hubEntity: string | null;
  hubFieldCount: number;
  multiWriterFields: Array<{ field: string; writerCount: number }>;
  isTail: boolean;
}

export interface SurfaceEnvItem {
  id: string;
  name: string;
  isSecret: boolean;
  isBuiltin: boolean;
  hasCode: boolean;
  hasExample: boolean;
  hasCi: boolean;
  iacKind: "secret" | "env" | null;
  isDrift: boolean;
  isDeclaredOnly: boolean;
  services: string[];
  sampleFile: string;
  hasSource: boolean;
  sources: string[];
}

export interface SurfaceFkItem {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  onDelete: string | null;
  isCascade: boolean;
  file: string;
}

export interface SurfacesModel {
  endpoints: SurfaceEndpointItem[];
  entities: SurfaceEntityItem[];
  entityDomains: string[];
  entityDatastores: string[];
  envVars: SurfaceEnvItem[];
  envServices: string[];
  foreignKeys: SurfaceFkItem[];
  totals: {
    endpoints: number;
    rawEndpoints: number;
    noGuardEndpoints: number;
    publicEndpoints: number;
    writeEndpoints: number;
    sourceEndpoints: number;
    contractOnlyEndpoints: number;
    entities: number;
    crossDomainEntities: number;
    noContractEntities: number;
    noDomainEntities: number;
    undeclaredEntities: number;
    flaggedEntities: number;
    multiWriterFieldCount: number;
    envVars: number;
    secrets: number;
    secretsInIac: number;
    secretsDrift: number;
    driftVars: number;
    declaredOnlyVars: number;
    builtinVars: number;
    foreignKeys: number;
    cascadeFks: number;
  };
}

const BUILTIN_ENV_EXACT = new Set([
  "CI",
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SHELL",
  "USER",
  "LOGNAME",
  "PWD",
  "OLDPWD",
  "TERM",
  "TZ",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "VITEST",
  "JEST_WORKER_ID",
  "BUN_ENV",
  "FORCE_COLOR",
  "NO_COLOR",
  "DEBUG",
  "HOSTNAME",
  "PORT",
]);

const BUILTIN_ENV_PREFIXES = ["GITHUB_", "RUNNER_", "ACTIONS_", "npm_", "BUN_", "CI_"];

const KEEP_S_ENDINGS = new Set([
  "status",
  "address",
  "access",
  "metrics",
  "analytics",
  "settings",
  "news",
  "canvas",
  "bus",
]);

export function normalizeEntityKey(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.length <= 3 || KEEP_S_ENDINGS.has(s)) return s;
  if (s.endsWith("ies") && s.length > 4) return s.slice(0, -3) + "y";
  if (s.endsWith("ses") || s.endsWith("xes") || s.endsWith("zes") || s.endsWith("ches") || s.endsWith("shes")) {
    return s.slice(0, -2);
  }
  if (s.endsWith("s") && !s.endsWith("ss") && !s.endsWith("us") && !s.endsWith("is")) {
    return s.slice(0, -1);
  }
  return s;
}

export function classifyEndpointGuard(rawGuard: string | null): {
  guardClass: "guarded" | "public" | "unknown";
  guardName: string;
  guardExpr: string | null;
} {
  const trimmed = (rawGuard ?? "").trim();
  if (!trimmed) return { guardClass: "unknown", guardName: "", guardExpr: null };
  if (trimmed.toLowerCase() === "public") return { guardClass: "public", guardName: "public", guardExpr: null };
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? trimmed;
  const callMatch = firstLine.match(/^([A-Za-z_$][A-Za-z0-9_$.]*)/);
  const short = (callMatch?.[1] ?? firstLine).slice(0, 32);
  const isComplex = trimmed.includes("\n") || trimmed.length > short.length;
  return {
    guardClass: "guarded",
    guardName: short,
    guardExpr: isComplex ? trimmed : null,
  };
}

function isBuiltinEnvName(name: string): boolean {
  if (BUILTIN_ENV_EXACT.has(name)) return true;
  return BUILTIN_ENV_PREFIXES.some((p) => name.startsWith(p));
}

function shortUnitLabel(name: string): string {
  const s = name.trim();
  const slash = s.indexOf("/");
  return s.startsWith("@") && slash > 0 ? s.slice(slash + 1) : s;
}

function extractPathPrefixes(pathStr: string): { prefix: string; subPrefix: string } {
  const segs = pathStr.split("/").filter(Boolean);
  if (segs.length <= 1) return { prefix: "(root)", subPrefix: "" };
  const first = segs[0] ?? "(root)";
  if (first.startsWith(":") || first.startsWith("{")) return { prefix: "(root)", subPrefix: "" };
  const rest = segs.slice(1).filter((s) => !/^v\d+$/i.test(s) && !s.startsWith(":") && !s.startsWith("{"));
  return { prefix: first, subPrefix: rest[0] ?? "" };
}

function isWriteMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}

export interface SurfacesSpecInput {
  repo: Pick<RepoSpecV4["repo"], "name">;
  nodes: Array<Pick<RepoSpecV4["nodes"][number], "kind" | "label">>;
  invariants: Array<Pick<RepoSpecV4["invariants"][number], "id" | "status" | "evidence">>;
  entities: RepoSpecV4["entities"];
  surfaces: Pick<RepoSpecV4["surfaces"], "endpoints" | "envBindings" | "foreignKeys">;
}

export function buildSurfacesModel(
  spec: SurfacesSpecInput,
  lifecycles: readonly Pick<EntityFieldLifecycle, "entity" | "field" | "writers" | "multiWriterRisk">[],
  drilldown?: { files: readonly Pick<DrilldownIndex["files"][number], "p">[] },
): SurfacesModel {
  const indexedFiles = new Set((drilldown?.files ?? []).map((f) => f.p));
  const repoRootUnit = spec.repo.name;

  const dedupedEndpoints = new Map<string, RepoSpecV4["surfaces"]["endpoints"][number]>();
  for (const ep of spec.surfaces.endpoints) {
    const key = ep.method.toUpperCase() + " " + ep.path;
    const prev = dedupedEndpoints.get(key);
    if (!prev) {
      dedupedEndpoints.set(key, ep);
      continue;
    }
    const prevScore = (prev.unit !== repoRootUnit ? 4 : 0) + (indexedFiles.has(prev.file) ? 2 : 0) + (prev.authGuard ? 1 : 0);
    const nextScore = (ep.unit !== repoRootUnit ? 4 : 0) + (indexedFiles.has(ep.file) ? 2 : 0) + (ep.authGuard ? 1 : 0);
    if (nextScore > prevScore) dedupedEndpoints.set(key, ep);
  }

  const endpoints: SurfaceEndpointItem[] = Array.from(dedupedEndpoints.values()).map((ep, idx) => {
    const g = classifyEndpointGuard(ep.authGuard);
    const { prefix, subPrefix } = extractPathPrefixes(ep.path);
    const hasSource = indexedFiles.has(ep.file);
    return {
      id: "ep:" + idx + ":" + ep.method.toUpperCase() + ":" + ep.path,
      unit: ep.unit,
      method: ep.method.toUpperCase(),
      path: ep.path,
      guardClass: g.guardClass,
      guardName: g.guardName,
      guardExpr: g.guardExpr,
      source: ep.source,
      resolution: ep.resolution ?? ep.source,
      file: ep.file,
      line: ep.line ?? 1,
      hasSource,
      prefix,
      subPrefix,
      isWrite: isWriteMethod(ep.method),
    };
  });

  const flaggedSet = new Set<string>();
  for (const inv of spec.invariants) {
    if (inv.status !== "fail" && inv.status !== "warn") continue;
    if (inv.id.includes("entity") || inv.id.includes("collection") || inv.id.includes("firestore")) {
      for (const ev of inv.evidence) {
        flaggedSet.add(ev.subject);
        const tail = ev.subject.split(":").pop();
        if (tail) flaggedSet.add(tail);
      }
    }
  }

  const hubsByNorm = new Map<string, { entity: string; fields: Array<Pick<EntityFieldLifecycle, "entity" | "field" | "writers" | "multiWriterRisk">> }>();
  for (const lf of lifecycles) {
    const norm = normalizeEntityKey(lf.entity);
    const cur = hubsByNorm.get(norm) ?? { entity: lf.entity, fields: [] };
    if (lf.entity.length > cur.entity.length && cur.fields.length === 0) cur.entity = lf.entity;
    cur.fields.push(lf);
    hubsByNorm.set(norm, cur);
  }

  const domainSet = new Set<string>();
  const storeSet = new Set<string>();
  const entities: SurfaceEntityItem[] = spec.entities.map((e, idx) => {
    for (const d of e.domains) domainSet.add(d);
    storeSet.add(e.datastore);
    const flagged = flaggedSet.has(e.entity) || flaggedSet.has(e.datastore + ":" + e.entity);
    const hub = hubsByNorm.get(normalizeEntityKey(e.entity)) ?? null;
    const multiWriterFields = (hub?.fields ?? [])
      .filter((f) => f.multiWriterRisk || f.writers.length >= 2)
      .map((f) => ({ field: f.field, writerCount: f.writers.length }))
      .sort((a, b) => b.writerCount - a.writerCount);
    const crossDomain = e.domains.length >= 2;
    const noContract = crossDomain && !e.authorizedShared;
    const noDomain = e.domains.length === 0;
    const isTail = e.totalRefs <= 3 && e.domains.length <= 1 && !flagged && !e.authorizedShared;
    return {
      id: "ent:" + idx + ":" + e.datastore + ":" + e.entity,
      entity: e.entity,
      datastore: e.datastore,
      totalRefs: e.totalRefs,
      domains: [...e.domains].sort(),
      layers: [...e.layers],
      sampleFiles: e.sampleFiles.filter((f) => indexedFiles.has(f)),
      declared: e.declared,
      authorizedShared: e.authorizedShared,
      fkCount: e.fkCount,
      hasTenancyKey: e.hasTenancyKey,
      crossDomain,
      noContract,
      noDomain,
      flagged,
      hubEntity: hub?.entity ?? null,
      hubFieldCount: hub?.fields.length ?? 0,
      multiWriterFields,
      isTail,
    };
  });
  entities.sort((a, b) => b.totalRefs - a.totalRefs || b.domains.length - a.domains.length || a.entity.localeCompare(b.entity));

  const realAppNodes = new Set(
    spec.nodes
      .filter((n) => (n.kind === "app" || n.kind === "native_app" || n.kind === "package") && n.label !== repoRootUnit)
      .map((n) => n.label),
  );
  const serviceCounts = new Map<string, number>();
  const envVars: SurfaceEnvItem[] = spec.surfaces.envBindings.map((eb, idx) => {
    const srcSet = new Set(eb.sources);
    const hasCode = srcSet.has("code_read");
    const hasExample = srcSet.has("env_example");
    const hasCi = srcSet.has("ci_config");
    const iacKind = srcSet.has("iac_secret") ? "secret" : srcSet.has("iac_env") ? "env" : null;
    const isBuiltin = isBuiltinEnvName(eb.name);
    const isDrift = hasCode && !hasExample && !hasCi && !iacKind && !isBuiltin;
    const isDeclaredOnly = !hasCode && (hasExample || hasCi || Boolean(iacKind));
    const appUnits = eb.units.filter((u) => u !== repoRootUnit && u !== "iac" && (realAppNodes.size === 0 || realAppNodes.has(u)));
    const services = appUnits.length > 0 ? appUnits.map(shortUnitLabel) : ["repo tooling & CI"];
    for (const svc of services) serviceCounts.set(svc, (serviceCounts.get(svc) ?? 0) + 1);
    return {
      id: "env:" + idx + ":" + eb.name,
      name: eb.name,
      isSecret: eb.isSecret,
      isBuiltin,
      hasCode,
      hasExample,
      hasCi,
      iacKind,
      isDrift,
      isDeclaredOnly,
      services,
      sampleFile: eb.sampleFile,
      hasSource: indexedFiles.has(eb.sampleFile),
      sources: [...eb.sources],
    };
  });

  const envServices = Array.from(serviceCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([s]) => s);

  const foreignKeys: SurfaceFkItem[] = spec.surfaces.foreignKeys.map((fk, idx) => ({
    id: "fk:" + idx + ":" + fk.fromTable + "." + fk.fromColumn,
    fromTable: fk.fromTable,
    fromColumn: fk.fromColumn,
    toTable: fk.toTable,
    toColumn: fk.toColumn,
    onDelete: fk.onDelete,
    isCascade: (fk.onDelete ?? "").toUpperCase() === "CASCADE",
    file: fk.file,
  }));

  const multiWriterFieldCount = lifecycles.filter((lf) => lf.multiWriterRisk || lf.writers.length >= 2).length;

  return {
    endpoints,
    entities,
    entityDomains: Array.from(domainSet).sort(),
    entityDatastores: Array.from(storeSet).sort(),
    envVars,
    envServices,
    foreignKeys,
    totals: {
      endpoints: endpoints.length,
      rawEndpoints: spec.surfaces.endpoints.length,
      noGuardEndpoints: endpoints.filter((e) => e.guardClass === "unknown").length,
      publicEndpoints: endpoints.filter((e) => e.guardClass === "public").length,
      writeEndpoints: endpoints.filter((e) => e.isWrite).length,
      sourceEndpoints: endpoints.filter((e) => e.hasSource).length,
      contractOnlyEndpoints: endpoints.filter((e) => !e.hasSource).length,
      entities: entities.length,
      crossDomainEntities: entities.filter((e) => e.crossDomain).length,
      noContractEntities: entities.filter((e) => e.noContract).length,
      noDomainEntities: entities.filter((e) => e.noDomain).length,
      undeclaredEntities: entities.filter((e) => !e.declared).length,
      flaggedEntities: entities.filter((e) => e.flagged).length,
      multiWriterFieldCount,
      envVars: envVars.length,
      secrets: envVars.filter((e) => e.isSecret).length,
      secretsInIac: envVars.filter((e) => e.isSecret && e.iacKind !== null).length,
      secretsDrift: envVars.filter((e) => e.isSecret && e.isDrift).length,
      driftVars: envVars.filter((e) => e.isDrift).length,
      declaredOnlyVars: envVars.filter((e) => e.isDeclaredOnly).length,
      builtinVars: envVars.filter((e) => e.isBuiltin).length,
      foreignKeys: foreignKeys.length,
      cascadeFks: foreignKeys.filter((f) => f.isCascade).length,
    },
  };
}
