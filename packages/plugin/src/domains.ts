import type { Effect, Scope } from "effect";
import type {
  AstIndexData,
  DiagramLayout,
  ExtractorPlugin,
  GraphFragment,
  ModuleCard,
  RepoContext,
  RepoSpecV4,
  SpecEdge,
  SpecNode,
  SqlInvariantResult,
  StateMachineRecord,
  StaticTrace,
  UnitDescriptor,
} from "./schema.ts";

export type FileSymbolTuple = [
  name: string,
  vis: "pub" | "priv",
  kind: "fn" | "method" | "class" | "const",
  startLine: number,
  endLine: number,
  owner?: string,
];

export interface DrilldownFile {
  p: string;
  u: string;
  d: string;
  l: number;
  e: number;
  c: string[];
  s: Array<[string, string, number]>;
  x: string[];
  t: string[];
  v: string[];
  tc?: 0 | 1;
  fc?: number;
  ch?: number;
  m?: FileSymbolTuple[];
  k?: Array<[number, number, number]>;
  o?: Array<[number, string, number]>;
}

export interface DrilldownIndex {
  files: DrilldownFile[];
  edges: Array<[number, number, number]>;
  sourcesGzipBase64?: string;
  extraSources?: Record<string, string>;
}

export interface PluginRegistration { readonly dispose: () => Promise<void> | void }
export interface EffectRegistration { readonly dispose: Effect.Effect<void> }

export interface DomainEditor<TItem> {
  readonly list: () => readonly TItem[];
  readonly get: (id: string) => TItem | undefined;
  readonly add: (item: TItem) => void;
  readonly update: (id: string, fn: (item: TItem) => void) => void;
  readonly remove: (id: string) => void;
}

export interface LanguageItem {
  readonly id: string;
  readonly label?: string;
  readonly extensions?: readonly string[];
  readonly extractor?: ExtractorPlugin;
}

export interface ExtractorItem {
  readonly id: string;
  readonly domain?: ExtractorPlugin["domain"];
  readonly extract: (ctx: RepoContext) => Promise<GraphFragment> | GraphFragment;
}

export interface LinkerItem {
  readonly id: string;
  readonly link: (ctx: RepoContext, fragments: readonly GraphFragment[]) => GraphFragment | Promise<GraphFragment>;
}

export interface RuleItem { readonly id: string; readonly dir?: string; readonly sql?: string }
export interface QueryItem { readonly id: string; readonly sql?: string; readonly run?: (args: Record<string, unknown>) => unknown }

export interface DiagramProviderItem {
  readonly id: string;
  readonly buildModuleArchitecture?: (params: { readonly units: UnitDescriptor[]; readonly ast: AstIndexData }) => {
    readonly modules: ModuleCard[];
    readonly diagrams: DiagramLayout[];
  };
  readonly buildAllDiagrams?: (
    nodes: SpecNode[],
    edges: SpecEdge[],
    stateMachines: StateMachineRecord[],
    moduleDiagrams: DiagramLayout[],
  ) => DiagramLayout[];
  readonly resolveEvidenceAnchors?: (invariants: SqlInvariantResult[], diagrams: DiagramLayout[]) => SqlInvariantResult[];
  readonly buildStaticTraces?: (diagrams: DiagramLayout[]) => StaticTrace[];
}

export interface StudioTabItem {
  readonly id: string;
  readonly label: string;
  readonly renderHtml: (ctx: unknown) => string;
}

export interface StudioRenderContribution {
  readonly id: string;
  readonly renderVisualHtml?: (spec: RepoSpecV4, digest: string, opts?: Record<string, unknown>) => string;
  readonly buildDrilldownIndex?: (
    units: UnitDescriptor[],
    ast: AstIndexData,
    rootDir: string,
    realCoverage: unknown,
    extraFiles?: readonly string[],
  ) => DrilldownIndex;
}

export interface StudioEditor {
  readonly addTab: (tab: StudioTabItem) => void;
  readonly removeTab: (id: string) => void;
  readonly listTabs: () => readonly { readonly id: string; readonly label: string }[];
  readonly addCss: (css: string) => void;
  readonly setRenderer?: (renderer: StudioRenderContribution) => void;
  readonly setUi?: (ui: Record<string, unknown>) => void;
}

export type ShowMeTriageFn = (ctx: unknown, current: Record<string, unknown>) => Record<string, unknown>;

export interface ShowMeEditor {
  readonly addTriage: (id: string, fn: ShowMeTriageFn) => void;
  readonly removeTriage: (id: string) => void;
  readonly listTriages?: () => readonly { readonly id: string }[];
}

export interface CiGateItem {
  readonly id: string;
  readonly name: string;
  readonly severity: "error" | "warn";
  readonly evaluate: (ctx: unknown) => { readonly passed: boolean; readonly message: string; readonly items?: readonly string[] };
}

export interface CiEditor {
  readonly addGate: (gate: CiGateItem) => void;
  readonly removeGate: (id: string) => void;
  readonly listGates: () => readonly { readonly id: string }[];
}

export interface CommandItem {
  readonly id: string;
  readonly description?: string;
  readonly run?: (args: Record<string, unknown>) => unknown;
}

export type PipelineHookName = "beforeScan" | "afterExtract" | "afterEvaluate" | "beforeRender";
export type PipelineHookHandler = (event: Record<string, unknown>) => void | Promise<void>;

export interface PromiseTransformDomain<TEditor> {
  readonly transform: (cb: (editor: TEditor) => void) => Promise<PluginRegistration>;
}

export interface EffectTransformDomain<TEditor> {
  readonly transform: (cb: (editor: TEditor) => void) => Effect.Effect<EffectRegistration, never, Scope.Scope>;
}

export interface PluginContext {
  readonly options: Record<string, unknown>;
  readonly language: PromiseTransformDomain<DomainEditor<LanguageItem>>;
  readonly extractor: PromiseTransformDomain<DomainEditor<ExtractorItem>>;
  readonly linker: PromiseTransformDomain<DomainEditor<LinkerItem>>;
  readonly rule: PromiseTransformDomain<DomainEditor<RuleItem>>;
  readonly query: PromiseTransformDomain<DomainEditor<QueryItem>>;
  readonly diagram: PromiseTransformDomain<DomainEditor<DiagramProviderItem>>;
  readonly studio: PromiseTransformDomain<StudioEditor>;
  readonly showMe: PromiseTransformDomain<ShowMeEditor>;
  readonly ci: PromiseTransformDomain<CiEditor>;
  readonly command: PromiseTransformDomain<DomainEditor<CommandItem>>;
  readonly pipeline: {
    readonly hook: (name: PipelineHookName, handler: PipelineHookHandler) => Promise<PluginRegistration>;
  };
}

export interface EffectPluginContext {
  readonly options: Record<string, unknown>;
  readonly language: EffectTransformDomain<DomainEditor<LanguageItem>>;
  readonly extractor: EffectTransformDomain<DomainEditor<ExtractorItem>>;
  readonly linker: EffectTransformDomain<DomainEditor<LinkerItem>>;
  readonly rule: EffectTransformDomain<DomainEditor<RuleItem>>;
  readonly query: EffectTransformDomain<DomainEditor<QueryItem>>;
  readonly diagram: EffectTransformDomain<DomainEditor<DiagramProviderItem>>;
  readonly studio: EffectTransformDomain<StudioEditor>;
  readonly showMe: EffectTransformDomain<ShowMeEditor>;
  readonly ci: EffectTransformDomain<CiEditor>;
  readonly command: EffectTransformDomain<DomainEditor<CommandItem>>;
  readonly pipeline: {
    readonly hook: (name: PipelineHookName, handler: PipelineHookHandler) => Effect.Effect<EffectRegistration, never, Scope.Scope>;
  };
}

export type PluginCleanup = () => void | Promise<void>;

export interface PromisePluginDefinition {
  readonly _tag?: "PromisePlugin";
  readonly id: string;
  readonly guarded?: boolean;
  readonly setup: (ctx: PluginContext) => void | PluginCleanup | Promise<void | PluginCleanup>;
}

export interface EffectPluginDefinition<R = Scope.Scope> {
  readonly _tag: "EffectPlugin";
  readonly id: string;
  readonly guarded?: boolean;
  readonly effect: (ctx: EffectPluginContext) => Effect.Effect<void, unknown, R>;
}

export type AnyPluginDefinition = PromisePluginDefinition | EffectPluginDefinition<Scope.Scope>;
