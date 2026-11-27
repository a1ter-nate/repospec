import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const REPOSPEC_ROOT = path.resolve(import.meta.dir, "../..");

export interface ImportEdge {
  readonly fromRel: string;
  readonly specifier: string;
  readonly line: number;
}

export interface DirectoryAudit {
  readonly files: string[];
  readonly totalLines: number;
  readonly imports: ImportEdge[];
}

export interface PluginStatusEntry {
  readonly id: string;
  readonly source: string | { readonly type: string };
  readonly status?: "active" | "failed";
  readonly state?: { readonly status: "active" | "failed"; readonly error?: string };
  readonly guarded?: boolean;
  readonly error?: string;
}

export interface PluginRegistration {
  readonly dispose: () => Promise<void> | void;
}

export interface StateInstance<TState, TEditor> {
  readonly get: () => TState;
  readonly transform: (cb: (editor: TEditor) => void) => unknown;
  readonly reload: () => unknown;
  readonly revision: () => number;
}

export interface DomainEditor<TItem> {
  readonly list: () => readonly TItem[];
  readonly get: (id: string) => TItem | undefined;
  readonly add: (item: TItem) => void;
  readonly update?: (id: string, fn: (item: TItem) => void) => void;
  readonly remove: (id: string) => void;
}

export interface StudioEditor {
  readonly addTab: (tab: {
    readonly id: string;
    readonly label: string;
    readonly renderHtml: (ctx: unknown) => string;
  }) => void;
  readonly removeTab?: (id: string) => void;
  readonly listTabs: () => readonly { readonly id: string; readonly label: string }[];
  readonly addCss?: (css: string) => void;
}

export interface ShowMeEditor {
  readonly addTriage: (
    id: string,
    fn: (ctx: unknown, current: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
  readonly removeTriage?: (id: string) => void;
}

export interface CiEditor {
  readonly addGate: (gate: {
    readonly id: string;
    readonly name: string;
    readonly severity: "error" | "warn";
    readonly evaluate: (ctx: unknown) => { readonly passed: boolean; readonly message: string; readonly items?: readonly string[] };
  }) => void;
  readonly removeGate?: (id: string) => void;
  readonly listGates: () => readonly { readonly id: string }[];
}

export interface PluginContextContract {
  readonly options: Record<string, unknown>;
  readonly language: {
    readonly transform: (cb: (editor: DomainEditor<Record<string, unknown>>) => void) => Promise<PluginRegistration>;
  };
  readonly extractor: {
    readonly transform: (cb: (editor: DomainEditor<Record<string, unknown>>) => void) => Promise<PluginRegistration>;
  };
  readonly linker: {
    readonly transform: (cb: (editor: DomainEditor<Record<string, unknown>>) => void) => Promise<PluginRegistration>;
  };
  readonly rule: {
    readonly transform: (cb: (editor: DomainEditor<Record<string, unknown>>) => void) => Promise<PluginRegistration>;
  };
  readonly query: {
    readonly transform: (cb: (editor: DomainEditor<Record<string, unknown>>) => void) => Promise<PluginRegistration>;
  };
  readonly diagram: {
    readonly transform: (cb: (editor: DomainEditor<Record<string, unknown>>) => void) => Promise<PluginRegistration>;
  };
  readonly studio: {
    readonly transform: (cb: (editor: StudioEditor) => void) => Promise<PluginRegistration>;
  };
  readonly showMe: {
    readonly transform: (cb: (editor: ShowMeEditor) => void) => Promise<PluginRegistration>;
  };
  readonly ci: {
    readonly transform: (cb: (editor: CiEditor) => void) => Promise<PluginRegistration>;
  };
  readonly command: {
    readonly transform: (cb: (editor: DomainEditor<Record<string, unknown>>) => void) => Promise<PluginRegistration>;
  };
  readonly pipeline: {
    readonly hook: (
      name: "beforeScan" | "afterExtract" | "afterEvaluate" | "beforeRender",
      handler: (event: Record<string, unknown>) => void | Promise<void>,
    ) => Promise<PluginRegistration>;
  };
}

export interface PromisePluginDefinition {
  readonly id: string;
  readonly guarded?: boolean;
  readonly setup: (
    ctx: PluginContextContract,
  ) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
}

export interface PluginOperation {
  readonly type: "add" | "remove";
  readonly target: string;
}

export interface PluginHostInstance {
  readonly list: () => Promise<readonly PluginStatusEntry[]> | readonly PluginStatusEntry[];
  readonly activate: (
    plugins: readonly unknown[],
    operations?: readonly PluginOperation[],
  ) => Promise<void>;
  readonly dispose: () => Promise<void>;
  readonly scan: (
    repoDir: string,
    opts?: { readonly dbPath?: string; readonly storageMode?: "artifact" | "committed" },
  ) => Promise<{
    readonly spec: Record<string, unknown>;
    readonly digest: string;
    readonly dbPath: string;
  }>;
  readonly renderStudio: (scanResult: unknown) => Promise<string> | string;
  readonly check: (
    repoDir: string,
    opts?: { readonly allowFail?: boolean },
  ) => Promise<{
    readonly ok: boolean;
    readonly customGates?: readonly { readonly id: string; readonly passed: boolean }[];
    readonly failedInvariants?: readonly { readonly id: string }[];
  }>;
}

export interface LoadedPluginRuntime {
  readonly definePlugin: (def: PromisePluginDefinition) => unknown;
  readonly fromPromise: (def: PromisePluginDefinition) => unknown;
  readonly createState: <TState, TEditor>(opts: {
    readonly name?: string;
    readonly initial: () => TState;
    readonly editor: (state: TState) => TEditor;
  }) => StateInstance<TState, TEditor>;
  readonly createPluginHost: (opts?: {
    readonly repoDir?: string;
    readonly plugins?: readonly unknown[];
    readonly operations?: readonly PluginOperation[];
    readonly includeBuiltins?: boolean;
  }) => Promise<PluginHostInstance>;
}

export function collectTsFiles(rootDir: string, relDir: string): string[] {
  const start = path.join(rootDir, relDir);
  if (!fs.existsSync(start)) return [];
  const results: string[] = [];
  const stack: string[] = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "out" || entry.name === ".git") {
        continue;
      }
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (
        entry.isFile() &&
        entry.name.match(/\.(?:ts|tsx|mts)$/) !== null &&
        !entry.name.endsWith(".d.ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".test.tsx")
      ) {
        results.push(path.relative(rootDir, abs).split(path.sep).join("/"));
      }
    }
  }
  return results.sort();
}

export function extractStaticImports(rootDir: string, relFile: string): ImportEdge[] {
  const abs = path.join(rootDir, relFile);
  if (!fs.existsSync(abs)) return [];
  const text = fs.readFileSync(abs, "utf8");
  const kind = relFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(relFile, text, ts.ScriptTarget.Latest, true, kind);
  const edges: ImportEdge[] = [];

  const record = (specifier: string, pos: number): void => {
    const { line } = sf.getLineAndCharacterOfPosition(pos);
    edges.push({ fromRel: relFile, specifier, line: line + 1 });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      record(node.moduleSpecifier.text, node.moduleSpecifier.getStart(sf));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      record(node.moduleSpecifier.text, node.moduleSpecifier.getStart(sf));
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const first = node.arguments[0];
      if (first && ts.isStringLiteral(first)) {
        record(first.text, first.getStart(sf));
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return edges;
}

export function auditDirectory(rootDir: string, relDir: string): DirectoryAudit {
  const files = collectTsFiles(rootDir, relDir);
  let totalLines = 0;
  const imports: ImportEdge[] = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(rootDir, rel), "utf8");
    totalLines += text.split("\n").length;
    imports.push(...extractStaticImports(rootDir, rel));
  }
  return { files, totalLines, imports };
}

export function resolveRelativeImport(fromRel: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), specifier));
}

export function readPluginStatus(entry: PluginStatusEntry): "active" | "failed" | undefined {
  if (entry.state?.status) return entry.state.status;
  return entry.status;
}

function asRecord(val: unknown): Record<string, unknown> | null {
  if (typeof val !== "object" || val === null) return null;
  return val as Record<string, unknown>;
}

export async function loadRepoSpecPluginRuntime(): Promise<LoadedPluginRuntime | null> {
  const pluginSdkPath = path.join(REPOSPEC_ROOT, "packages/plugin/src/index.ts");
  const coreEntryPath = path.join(REPOSPEC_ROOT, "packages/core/src/index.ts");
  if (!fs.existsSync(pluginSdkPath) || !fs.existsSync(coreEntryPath)) return null;

  const pluginMod = asRecord(await import(pathToFileURL(pluginSdkPath).href));
  const coreMod = asRecord(await import(pathToFileURL(coreEntryPath).href));
  if (!pluginMod || !coreMod) return null;

  const pluginNamespace = asRecord(pluginMod.Plugin);
  const definePlugin =
    typeof pluginNamespace?.define === "function"
      ? (pluginNamespace.define as LoadedPluginRuntime["definePlugin"])
      : typeof pluginMod.definePlugin === "function"
        ? (pluginMod.definePlugin as LoadedPluginRuntime["definePlugin"])
        : null;

  const fromPromise =
    typeof pluginMod.fromPromise === "function"
      ? (pluginMod.fromPromise as LoadedPluginRuntime["fromPromise"])
      : typeof pluginNamespace?.fromPromise === "function"
        ? (pluginNamespace.fromPromise as LoadedPluginRuntime["fromPromise"])
        : null;

  const stateNamespace = asRecord(coreMod.State) ?? asRecord(pluginMod.State);
  const createState =
    typeof stateNamespace?.create === "function"
      ? (stateNamespace.create as LoadedPluginRuntime["createState"])
      : typeof coreMod.createState === "function"
        ? (coreMod.createState as LoadedPluginRuntime["createState"])
        : null;

  const hostNamespace = asRecord(coreMod.PluginHost);
  const createPluginHost =
    typeof coreMod.createPluginHost === "function"
      ? (coreMod.createPluginHost as LoadedPluginRuntime["createPluginHost"])
      : typeof hostNamespace?.create === "function"
        ? (hostNamespace.create as LoadedPluginRuntime["createPluginHost"])
        : null;

  if (!definePlugin || !fromPromise || !createState || !createPluginHost) return null;
  return { definePlugin, fromPromise, createState, createPluginHost };
}
