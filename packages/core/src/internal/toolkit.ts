import { Glob } from "bun";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type {
  Domain,
  ExtractorPlugin,
  FactEdgeRecord,
  FactRecord,
  GraphFragment,
  MetricRecord,
  RepoContext,
  SpecDiagnostic,
  SpecEdge,
  SpecNode,
  SpecRule,
  UnitDescriptor,
} from "../../../../src/schema.ts";

export interface FactEmitInput {
  kind: string;
  key: string;
  file: string;
  line: number;
  unit?: string;
  symbol?: string;
  severity?: "info" | "warn" | "error";
  payload?: Record<string, unknown>;
}

export interface FactEdgeEmitInput {
  kind: string;
  fromRef: string;
  toRef: string;
  file: string;
  line: number;
  payload?: Record<string, unknown>;
}

export interface MetricEmitInput {
  scopeKind: "repo" | "unit" | "module" | "file";
  scopeId: string;
  name: string;
  valueNum?: number;
  valueText?: string;
}

export interface ScanToolkit {
  readonly ctx: RepoContext;
  readonly files: (globPattern?: string) => string[];
  readonly readText: (relPath: string) => string | null;
  readonly tsSourceFile: (relPath: string) => ts.SourceFile | null;
  readonly unitForFile: (relPath: string) => UnitDescriptor | undefined;
  readonly emitFact: (input: FactEmitInput) => void;
  readonly emitFactEdge: (input: FactEdgeEmitInput) => void;
  readonly emitMetric: (input: MetricEmitInput) => void;
  readonly emitNode: (node: SpecNode) => void;
  readonly emitEdge: (edge: SpecEdge) => void;
  readonly emitRule: (rule: SpecRule) => void;
  readonly emitDiagnostic: (diag: SpecDiagnostic) => void;
}

export interface CustomExtractorDefinition {
  readonly id: string;
  readonly domain?: Domain;
  readonly extract: (kit: ScanToolkit) => void | Promise<void>;
}

export interface RepoSpecConfig {
  readonly extractors?: readonly ExtractorPlugin[];
  readonly factsFile?: string;
  readonly rulesDir?: string;
  readonly report?: unknown;
  readonly showMe?: unknown;
  readonly ci?: unknown;
}

export interface SharedScanCache {
  readonly textByPath: Map<string, string | null>;
  readonly tsAstByPath: Map<string, ts.SourceFile | null>;
}

const cacheByRoot = new WeakMap<RepoContext, SharedScanCache>();

function getSharedCache(ctx: RepoContext): SharedScanCache {
  const existing = cacheByRoot.get(ctx);
  if (existing) return existing;
  const created: SharedScanCache = {
    textByPath: new Map(),
    tsAstByPath: new Map(),
  };
  cacheByRoot.set(ctx, created);
  return created;
}

function scriptKindForPath(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

export function createScanToolkit(ctx: RepoContext, extractorId: string): {
  kit: ScanToolkit;
  toFragment: () => GraphFragment;
} {
  const cache = getSharedCache(ctx);
  const unitsSorted = [...ctx.units].sort((a, b) => b.dir.length - a.dir.length);

  const nodes: SpecNode[] = [];
  const edges: SpecEdge[] = [];
  const rules: SpecRule[] = [];
  const diagnostics: SpecDiagnostic[] = [];
  const facts: FactRecord[] = [];
  const factEdges: FactEdgeRecord[] = [];
  const metrics: MetricRecord[] = [];

  const unitForFile = (relPath: string): UnitDescriptor | undefined => {
    const norm = relPath.replaceAll("\\", "/");
    for (const u of unitsSorted) {
      if (u.dir === "." || norm === u.dir || norm.startsWith(`${u.dir}/`)) return u;
    }
    return undefined;
  };

  const readText = (relPath: string): string | null => {
    if (cache.textByPath.has(relPath)) return cache.textByPath.get(relPath) ?? null;
    const abs = path.join(ctx.rootDir, relPath);
    if (!fs.existsSync(abs)) {
      cache.textByPath.set(relPath, null);
      return null;
    }
    try {
      const content = fs.readFileSync(abs, "utf8");
      cache.textByPath.set(relPath, content);
      return content;
    } catch {
      cache.textByPath.set(relPath, null);
      return null;
    }
  };

  const tsSourceFile = (relPath: string): ts.SourceFile | null => {
    if (cache.tsAstByPath.has(relPath)) return cache.tsAstByPath.get(relPath) ?? null;
    const text = readText(relPath);
    if (text === null) {
      cache.tsAstByPath.set(relPath, null);
      return null;
    }
    const sf = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, scriptKindForPath(relPath));
    cache.tsAstByPath.set(relPath, sf);
    return sf;
  };

  const files = (globPattern?: string): string[] => {
    if (!globPattern || globPattern === "**/*") return [...ctx.allFiles];
    const matcher = new Glob(globPattern);
    return ctx.allFiles.filter((f) => matcher.match(f));
  };

  const kit: ScanToolkit = {
    ctx,
    files,
    readText,
    tsSourceFile,
    unitForFile,
    emitFact: (input) => {
      const unit = input.unit ?? unitForFile(input.file)?.name ?? ctx.repoName;
      facts.push({
        extractorId,
        kind: input.kind,
        key: input.key,
        file: input.file,
        line: Math.max(1, Math.floor(input.line)),
        unit,
        symbol: input.symbol,
        severity: input.severity,
        payload: input.payload ?? {},
      });
    },
    emitFactEdge: (input) => {
      factEdges.push({
        extractorId,
        kind: input.kind,
        fromRef: input.fromRef,
        toRef: input.toRef,
        file: input.file,
        line: Math.max(1, Math.floor(input.line)),
        payload: input.payload,
      });
    },
    emitMetric: (input) => {
      metrics.push({
        extractorId,
        scopeKind: input.scopeKind,
        scopeId: input.scopeId,
        name: input.name,
        valueNum: input.valueNum,
        valueText: input.valueText,
      });
    },
    emitNode: (node) => {
      nodes.push(node);
    },
    emitEdge: (edge) => {
      edges.push(edge);
    },
    emitRule: (rule) => {
      rules.push(rule);
    },
    emitDiagnostic: (diag) => {
      diagnostics.push(diag);
    },
  };

  return {
    kit,
    toFragment: () => ({
      nodes,
      edges,
      rules,
      diagnostics,
      facts,
      factEdges,
      metrics,
    }),
  };
}

export function defineExtractor(def: CustomExtractorDefinition): ExtractorPlugin {
  return {
    id: def.id,
    domain: def.domain ?? "arch",
    async extract(ctx: RepoContext): Promise<GraphFragment> {
      const { kit, toFragment } = createScanToolkit(ctx, def.id);
      await def.extract(kit);
      return toFragment();
    },
  };
}

export function defineConfig(config: RepoSpecConfig): RepoSpecConfig {
  return config;
}
