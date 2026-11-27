import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildVerificationScopeSummary,
  decodeRepoSpecEffect,
  discoverRealCoverageReport,
  type DiagramLayout,
  type DrilldownIndex,
  type ExtractorPlugin,
  type FactRecord,
  type GraphFragment,
  type ModuleCard,
  type RealCoverageReport,
  type RepoSpecV4,
  type SqlInvariantResult,
  type StaticTrace,
  type StorageMode,
} from "@repospec/plugin";
import { Effect } from "effect";
import { buildCanonicalSpec, hashSpec, mergeFragments } from "../canonicalize.ts";
import { discoverRepo } from "../discover.ts";
import {
  createAndPopulateIndexDb,
  projectInvariantsToGraph,
  queryEntityOwnership,
  querySurfaces,
  queryVerificationCoverage,
  runSqlInvariants,
  storeDigestInDb,
} from "../indexDb.ts";
import { loadRepoExtensions, type LoadedRepoExtensions } from "../internal/loader.ts";
import { createDomainStates, flushAllDomainStates, type PluginDomainStates } from "./domains.ts";
import { createPluginSupervisor } from "./supervisor.ts";
import type { PluginCheckResult, PluginHostInstance, PluginHostOptions, PluginScanResult } from "./types.ts";

const DEFAULT_RULES_DIR = path.resolve(import.meta.dir, "../../../../rules");

interface CiGateLike {
  readonly id: string;
  readonly name: string;
  readonly severity: "error" | "warn";
  readonly evaluate: (ctx: unknown) => { readonly passed: boolean; readonly message: string; readonly items?: readonly string[] };
}

export interface ScanOverrides {
  readonly runExtractors?: (
    ctx: ReturnType<typeof discoverRepo>,
    extra: readonly ExtractorPlugin[],
  ) => Promise<{ readonly fragments: GraphFragment[]; readonly ids: string[] }>;
  readonly discoverCoverage?: (rootDir: string) => Promise<RealCoverageReport | null>;
}

function collectCiGates(domains: PluginDomainStates, repoCiDefs: readonly unknown[]): CiGateLike[] {
  const gates: CiGateLike[] = [...domains.ci.get().gates];
  for (const def of repoCiDefs) {
    if (!def || typeof def !== "object") continue;
    const cand = def as { gates?: readonly CiGateLike[] };
    if (Array.isArray(cand.gates)) gates.push(...cand.gates);
  }
  return gates;
}

async function runHooks(
  domains: PluginDomainStates,
  name: "beforeScan" | "afterExtract" | "afterEvaluate" | "beforeRender",
  event: Record<string, unknown>,
): Promise<void> {
  for (const h of domains.pipeline.get()) {
    if (h.name === name) await Promise.resolve(h.handler(event));
  }
}

async function executeExtractors(
  domains: PluginDomainStates,
  ctx: ReturnType<typeof discoverRepo>,
  repoExtractors: readonly ExtractorPlugin[],
  overrides?: ScanOverrides,
): Promise<{ readonly fragments: GraphFragment[]; readonly extractorIds: string[] }> {
  if (overrides?.runExtractors) {
    const custom = await overrides.runExtractors(ctx, repoExtractors);
    return { fragments: custom.fragments, extractorIds: custom.ids };
  }
  const active: ExtractorPlugin[] = domains.extractor.get().map((e) => ({
    id: e.id,
    domain: e.domain ?? "arch",
    extract: (repoCtx) => Promise.resolve(e.extract(repoCtx)),
  }));
  const all = [...active, ...repoExtractors];
  const fragments = await Promise.all(
    all.map(async (plugin): Promise<GraphFragment> => {
      try {
        return await plugin.extract(ctx);
      } catch (err) {
        return {
          nodes: [],
          edges: [],
          rules: [],
          diagnostics: [
            {
              code: `extractor.failed.${plugin.id}`,
              severity: "warn",
              message: `Extractor ${plugin.id} failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }),
  );
  return { fragments, extractorIds: all.map((e) => e.id) };
}

function collectFactFiles(facts: readonly FactRecord[]): string[] {
  const factFiles = new Set<string>();
  for (const f of facts) {
    if (f.file) factFiles.add(f.file);
    const p = f.payload as Record<string, unknown> | undefined;
    const prod = p?.producer as { file?: string } | undefined;
    const cons = p?.consumer as { file?: string } | undefined;
    if (prod?.file) factFiles.add(prod.file);
    if (cons?.file) factFiles.add(cons.file);
  }
  return Array.from(factFiles);
}

function evaluateIndexDb(params: {
  readonly domains: PluginDomainStates;
  readonly targetDbPath: string;
  readonly ctx: ReturnType<typeof discoverRepo>;
  readonly merged: ReturnType<typeof mergeFragments>;
  readonly modules: ModuleCard[];
  readonly realCoverage: RealCoverageReport | null;
  readonly repoExtraRulesDirs: readonly string[];
}): {
  readonly invariants: SqlInvariantResult[];
  readonly entities: ReturnType<typeof queryEntityOwnership>;
  readonly surfaces: ReturnType<typeof querySurfaces>;
  readonly verification: ReturnType<typeof queryVerificationCoverage>;
} {
  const ruleItems = params.domains.rule.get();
  const primaryRulesDir = ruleItems.find((r) => typeof r.dir === "string")?.dir ?? DEFAULT_RULES_DIR;
  const extraRulesDirs = [
    ...ruleItems.filter((r) => typeof r.dir === "string" && r.dir !== primaryRulesDir).map((r) => r.dir as string),
    ...params.repoExtraRulesDirs,
  ];
  const db = createAndPopulateIndexDb({
    dbPath: params.targetDbPath,
    repoName: params.ctx.repoName,
    commitSha: params.ctx.commitSha,
    scopeRootRel: params.ctx.scopeRootRel,
    units: params.ctx.units,
    nodes: params.merged.nodes,
    edges: params.merged.edges,
    rules: params.merged.rules,
    ast: params.merged.ast,
    stateMachines: params.merged.stateMachines,
    loops: params.merged.loops,
    catalogArtifacts: params.merged.catalogArtifacts,
    modules: params.modules,
    realCoverage: params.realCoverage,
    facts: params.merged.facts,
    factEdges: params.merged.factEdges,
    metrics: params.merged.metrics,
  });
  try {
    const invariants = runSqlInvariants(db, primaryRulesDir, params.merged.diagnostics, extraRulesDirs);
    const entities = queryEntityOwnership(db);
    const surfaces = querySurfaces(db);
    const verification = queryVerificationCoverage(db, invariants, params.realCoverage);
    return { invariants, entities, surfaces, verification };
  } finally {
    db.close();
  }
}

export async function scanWithDomains(
  domains: PluginDomainStates,
  repoDir: string,
  opts?: { readonly dbPath?: string; readonly storageMode?: "artifact" | "commit" | "committed" },
  overrides?: ScanOverrides,
): Promise<PluginScanResult & { readonly repoExtensions: LoadedRepoExtensions }> {
  flushAllDomainStates(domains);
  const mode: StorageMode = opts?.storageMode === "commit" || opts?.storageMode === "committed" ? "commit" : "artifact";
  await runHooks(domains, "beforeScan", { repoDir, storageMode: mode });

  const ctx = discoverRepo(repoDir, mode);
  const repoExtensions = await loadRepoExtensions(ctx.rootDir);
  const { fragments, extractorIds } = await executeExtractors(domains, ctx, repoExtensions.extractors, overrides);

  const linkers = domains.linker.get();
  const linkFragments: GraphFragment[] = [];
  for (const linker of linkers) linkFragments.push(await Promise.resolve(linker.link(ctx, fragments)));

  const merged = mergeFragments([...fragments, ...linkFragments]);
  if (repoExtensions.diagnostics.length > 0) merged.diagnostics.push(...repoExtensions.diagnostics);
  await runHooks(domains, "afterExtract", { repoDir, fragments: [...fragments, ...linkFragments] });

  const targetDbPath =
    opts?.dbPath ?? path.join(os.tmpdir(), `repospec-${process.pid}-${ctx.repoName.replace(/[^a-zA-Z0-9_-]/g, "_")}.sqlite`);
  const atlas = domains.diagram.get().find((d) => typeof d.buildModuleArchitecture === "function");
  const moduleArch: { readonly modules: ModuleCard[]; readonly diagrams: DiagramLayout[] } = atlas?.buildModuleArchitecture
    ? atlas.buildModuleArchitecture({ units: ctx.units, ast: merged.ast })
    : { modules: [], diagrams: [] };
  const realCoverage = overrides?.discoverCoverage ? await overrides.discoverCoverage(ctx.rootDir) : discoverRealCoverageReport(ctx.rootDir);
  const dbEval = evaluateIndexDb({ domains, targetDbPath, ctx, merged, modules: moduleArch.modules, realCoverage, repoExtraRulesDirs: repoExtensions.extraRulesDirs });

  const projected = projectInvariantsToGraph(merged.nodes, merged.edges, dbEval.invariants);
  const diagrams: DiagramLayout[] = atlas?.buildAllDiagrams
    ? atlas.buildAllDiagrams(projected.nodes, projected.edges, merged.stateMachines, moduleArch.diagrams)
    : [];
  const anchoredInvariants = atlas?.resolveEvidenceAnchors ? atlas.resolveEvidenceAnchors(dbEval.invariants, diagrams) : dbEval.invariants;
  const traces: StaticTrace[] = atlas?.buildStaticTraces ? atlas.buildStaticTraces(diagrams) : [];

  const rawSpec = buildCanonicalSpec({
    ctx,
    extractorIds: [...extractorIds, ...linkers.map((l) => l.id), ...(atlas ? ["module-graph.v5"] : []), "sqlite.invariants.v4"],
    nodes: projected.nodes,
    edges: projected.edges,
    rules: merged.rules,
    ast: merged.ast,
    invariants: anchoredInvariants,
    entities: dbEval.entities,
    stateMachines: merged.stateMachines,
    loops: merged.loops,
    catalogArtifacts: merged.catalogArtifacts,
    modules: moduleArch.modules,
    traces,
    surfaces: dbEval.surfaces,
    diagrams,
    verification: dbEval.verification,
    diagnostics: merged.diagnostics,
    facts: merged.facts,
    factEdges: merged.factEdges,
    metrics: merged.metrics,
  });

  const spec = await Effect.runPromise(decodeRepoSpecEffect(rawSpec));
  Object.defineProperty(spec, "ast", { value: merged.ast, enumerable: false, configurable: true });
  const digest = hashSpec(spec);
  storeDigestInDb(targetDbPath, digest);
  await runHooks(domains, "afterEvaluate", { repoDir, spec, digest });

  const commands = domains.command.get();
  const idsCmd = commands.find((c) => c.id === "sdk.ids");
  const sqliteCmd = commands.find((c) => c.id === "sdk.sqlite");
  const idsModule = typeof idsCmd?.run === "function" ? String(idsCmd.run({ spec, digest })) : "";
  const sdkModule = typeof sqliteCmd?.run === "function" ? String(sqliteCmd.run({})) : "";
  const studioState = domains.studio.get();
  const drilldown: DrilldownIndex = studioState.renderer?.buildDrilldownIndex
    ? studioState.renderer.buildDrilldownIndex(ctx.units, merged.ast, ctx.rootDir, realCoverage, collectFactFiles(merged.facts))
    : { files: [], edges: [] };

  return { spec, digest, idsModule, sdkModule, dbPath: targetDbPath, drilldown, repoExtensions };
}

export async function checkWithDomains(
  domains: PluginDomainStates,
  repoDir: string,
  checkOpts?: { readonly specPath?: string; readonly allowFail?: boolean },
): Promise<PluginCheckResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-host-check-"));
  try {
    const scanRes = await scanWithDomains(domains, repoDir, { dbPath: path.join(tmpDir, "check.sqlite"), storageMode: "artifact" });
    let drifted = false;
    if (checkOpts?.specPath) {
      const absSpec = path.resolve(checkOpts.specPath);
      if (fs.existsSync(absSpec)) {
        const committed = await Effect.runPromise(decodeRepoSpecEffect(JSON.parse(fs.readFileSync(absSpec, "utf8"))));
        drifted = hashSpec(committed) !== scanRes.digest;
      }
    }
    const gates = collectCiGates(domains, scanRes.repoExtensions.ciDefinitions);
    const customGates = gates.map((g) => {
      const out = g.evaluate({ spec: scanRes.spec, digest: scanRes.digest });
      return { id: g.id, name: g.name, severity: g.severity, passed: out.passed, message: out.message, items: out.items ?? [] };
    });
    const customCiOk = customGates.every((r) => r.passed || r.severity !== "error");
    const failedInvariants = scanRes.spec.invariants.filter((i) => i.status === "fail");
    const errorDiagnostics = scanRes.spec.diagnostics.filter((d) => d.severity === "error");
    const ok = !drifted && errorDiagnostics.length === 0 && (Boolean(checkOpts?.allowFail) || (failedInvariants.length === 0 && customCiOk));
    return {
      ok,
      drifted,
      digest: scanRes.digest,
      errorDiagnostics,
      failedInvariants: failedInvariants.map((i) => ({ id: i.id, name: i.name, count: i.violationCount })),
      customGates,
      scopeSummary: buildVerificationScopeSummary(scanRes.spec.verification),
      verification: scanRes.spec.verification,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function renderStudioWithDomains(domains: PluginDomainStates, scanResult: unknown): string {
  flushAllDomainStates(domains);
  const res = scanResult as {
    readonly spec: RepoSpecV4;
    readonly digest: string;
    readonly drilldown?: DrilldownIndex;
    readonly commitDiff?: unknown;
    readonly timeline?: unknown;
    readonly inline?: boolean;
  };
  const studioState = domains.studio.get();
  const mergedTheme: Record<string, unknown> = {};
  const mergedCss: string[] = [...studioState.css];
  const mergedTabs: unknown[] = [...studioState.tabs];
  const ui: Record<string, unknown> = {};
  for (const ov of studioState.uiOverrides) {
    Object.assign(ui, ov);
    if (ov.theme && typeof ov.theme === "object") Object.assign(mergedTheme, ov.theme);
    if (typeof ov.customCss === "string" && ov.customCss.trim()) mergedCss.push(ov.customCss);
    if (Array.isArray(ov.extraTabs)) mergedTabs.push(...ov.extraTabs);
  }
  if (Object.keys(mergedTheme).length > 0) ui.theme = mergedTheme;
  ui.extraTabs = mergedTabs;
  ui.customCss = mergedCss.join("\n");
  if (studioState.renderer?.renderVisualHtml) {
    return studioState.renderer.renderVisualHtml(res.spec, res.digest, {
      inline: Boolean(res.inline),
      drilldown: res.drilldown,
      commitDiff: res.commitDiff,
      timeline: res.timeline,
      ui,
    });
  }
  const tabHtml = studioState.tabs
    .map((t) => `<section data-tab="${t.id}"><h2>${t.label}</h2>${t.renderHtml(res)}</section>`)
    .join("\n");
  return `<!doctype html><html><head><style>${mergedCss.join("\n")}</style></head><body>${tabHtml}</body></html>`;
}

export async function createPluginHost(opts: PluginHostOptions = {}): Promise<PluginHostInstance & { readonly domains: PluginDomainStates }> {
  const domains = createDomainStates();
  const supervisor = createPluginSupervisor({ domains, includeBuiltins: opts.includeBuiltins !== false, options: opts.options ?? {} });
  await supervisor.activate(opts.plugins ?? [], opts.operations ?? []);
  return {
    domains,
    list: () => supervisor.list(),
    activate: (plugins, operations) => supervisor.activate(plugins, operations),
    dispose: () => supervisor.dispose(),
    scan: (repoDir, scanOpts) => scanWithDomains(domains, repoDir, scanOpts),
    renderStudio: (scanResult) => renderStudioWithDomains(domains, scanResult),
    check: (repoDir, checkOpts) => checkWithDomains(domains, repoDir, checkOpts),
  };
}

let defaultDomainsPromise: Promise<PluginDomainStates> | null = null;

export function getDefaultDomains(): Promise<PluginDomainStates> {
  if (!defaultDomainsPromise) {
    defaultDomainsPromise = createPluginHost({ includeBuiltins: true }).then((h) => h.domains);
  }
  return defaultDomainsPromise;
}

export const PluginHost = { create: createPluginHost };
