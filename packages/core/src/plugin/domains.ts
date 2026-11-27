import type {
  CiEditor,
  CiGateItem,
  CommandItem,
  DiagramProviderItem,
  DomainEditor,
  EffectPluginContext,
  ExtractorItem,
  LanguageItem,
  LinkerItem,
  PipelineHookHandler,
  PipelineHookName,
  QueryItem,
  RuleItem,
  ShowMeEditor,
  ShowMeTriageFn,
  StudioEditor,
  StudioRenderContribution,
  StudioTabItem,
} from "@repospec/plugin";
import { State, type StateInstance } from "../state.ts";

export interface StudioDomainState {
  readonly tabs: StudioTabItem[];
  readonly css: string[];
  renderer: StudioRenderContribution | null;
  readonly uiOverrides: Record<string, unknown>[];
}

export interface ShowMeDomainState {
  readonly triages: Array<{ readonly id: string; readonly fn: ShowMeTriageFn }>;
}

export interface CiDomainState {
  readonly gates: CiGateItem[];
}

export interface PipelineHookEntry {
  readonly name: PipelineHookName;
  readonly handler: PipelineHookHandler;
}

export interface PluginDomainStates {
  readonly language: StateInstance<LanguageItem[], DomainEditor<LanguageItem>>;
  readonly extractor: StateInstance<ExtractorItem[], DomainEditor<ExtractorItem>>;
  readonly linker: StateInstance<LinkerItem[], DomainEditor<LinkerItem>>;
  readonly rule: StateInstance<RuleItem[], DomainEditor<RuleItem>>;
  readonly query: StateInstance<QueryItem[], DomainEditor<QueryItem>>;
  readonly diagram: StateInstance<DiagramProviderItem[], DomainEditor<DiagramProviderItem>>;
  readonly studio: StateInstance<StudioDomainState, StudioEditor>;
  readonly showMe: StateInstance<ShowMeDomainState, ShowMeEditor>;
  readonly ci: StateInstance<CiDomainState, CiEditor>;
  readonly command: StateInstance<CommandItem[], DomainEditor<CommandItem>>;
  readonly pipeline: StateInstance<PipelineHookEntry[], { readonly add: (entry: PipelineHookEntry) => void }>;
}

function makeListEditor<T extends { readonly id: string }>(draft: T[]): DomainEditor<T> {
  return {
    list: () => [...draft],
    get: (id) => draft.find((item) => item.id === id),
    add: (item) => {
      const idx = draft.findIndex((existing) => existing.id === item.id);
      if (idx >= 0) {
        draft[idx] = item;
      } else {
        draft.push(item);
      }
    },
    update: (id, fn) => {
      const target = draft.find((item) => item.id === id);
      if (target) fn(target);
    },
    remove: (id) => {
      const idx = draft.findIndex((item) => item.id === id);
      if (idx >= 0) draft.splice(idx, 1);
    },
  };
}

export function createDomainStates(): PluginDomainStates {
  return {
    language: State.create<LanguageItem[], DomainEditor<LanguageItem>>({
      name: "language",
      initial: () => [],
      editor: makeListEditor,
    }),
    extractor: State.create<ExtractorItem[], DomainEditor<ExtractorItem>>({
      name: "extractor",
      initial: () => [],
      editor: makeListEditor,
    }),
    linker: State.create<LinkerItem[], DomainEditor<LinkerItem>>({
      name: "linker",
      initial: () => [],
      editor: makeListEditor,
    }),
    rule: State.create<RuleItem[], DomainEditor<RuleItem>>({
      name: "rule",
      initial: () => [],
      editor: makeListEditor,
    }),
    query: State.create<QueryItem[], DomainEditor<QueryItem>>({
      name: "query",
      initial: () => [],
      editor: makeListEditor,
    }),
    diagram: State.create<DiagramProviderItem[], DomainEditor<DiagramProviderItem>>({
      name: "diagram",
      initial: () => [],
      editor: makeListEditor,
    }),
    studio: State.create<StudioDomainState, StudioEditor>({
      name: "studio",
      initial: () => ({ tabs: [], css: [], renderer: null, uiOverrides: [] }),
      editor: (draft) => ({
        addTab: (tab) => {
          const idx = draft.tabs.findIndex((t) => t.id === tab.id);
          if (idx >= 0) draft.tabs[idx] = tab;
          else draft.tabs.push(tab);
        },
        removeTab: (id) => {
          const idx = draft.tabs.findIndex((t) => t.id === id);
          if (idx >= 0) draft.tabs.splice(idx, 1);
        },
        listTabs: () => draft.tabs.map((t) => ({ id: t.id, label: t.label })),
        addCss: (css) => {
          if (css.trim().length > 0) draft.css.push(css);
        },
        setRenderer: (renderer) => {
          draft.renderer = renderer;
        },
        setUi: (ui) => {
          draft.uiOverrides.push(ui);
        },
      }),
    }),
    showMe: State.create<ShowMeDomainState, ShowMeEditor>({
      name: "showMe",
      initial: () => ({ triages: [] }),
      editor: (draft) => ({
        addTriage: (id, fn) => {
          const idx = draft.triages.findIndex((t) => t.id === id);
          if (idx >= 0) draft.triages[idx] = { id, fn };
          else draft.triages.push({ id, fn });
        },
        removeTriage: (id) => {
          const idx = draft.triages.findIndex((t) => t.id === id);
          if (idx >= 0) draft.triages.splice(idx, 1);
        },
        listTriages: () => draft.triages.map((t) => ({ id: t.id })),
      }),
    }),
    ci: State.create<CiDomainState, CiEditor>({
      name: "ci",
      initial: () => ({ gates: [] }),
      editor: (draft) => ({
        addGate: (gate) => {
          const idx = draft.gates.findIndex((g) => g.id === gate.id);
          if (idx >= 0) draft.gates[idx] = gate;
          else draft.gates.push(gate);
        },
        removeGate: (id) => {
          const idx = draft.gates.findIndex((g) => g.id === id);
          if (idx >= 0) draft.gates.splice(idx, 1);
        },
        listGates: () => draft.gates.map((g) => ({ id: g.id })),
      }),
    }),
    command: State.create<CommandItem[], DomainEditor<CommandItem>>({
      name: "command",
      initial: () => [],
      editor: makeListEditor,
    }),
    pipeline: State.create<PipelineHookEntry[], { readonly add: (entry: PipelineHookEntry) => void }>({
      name: "pipeline",
      initial: () => [],
      editor: (draft) => ({
        add: (entry) => {
          draft.push(entry);
        },
      }),
    }),
  };
}

export function createEffectPluginContext(
  domains: PluginDomainStates,
  options: Record<string, unknown>,
): EffectPluginContext {
  return {
    options,
    language: { transform: (cb) => domains.language.transformEffect(cb) },
    extractor: { transform: (cb) => domains.extractor.transformEffect(cb) },
    linker: { transform: (cb) => domains.linker.transformEffect(cb) },
    rule: { transform: (cb) => domains.rule.transformEffect(cb) },
    query: { transform: (cb) => domains.query.transformEffect(cb) },
    diagram: { transform: (cb) => domains.diagram.transformEffect(cb) },
    studio: { transform: (cb) => domains.studio.transformEffect(cb) },
    showMe: { transform: (cb) => domains.showMe.transformEffect(cb) },
    ci: { transform: (cb) => domains.ci.transformEffect(cb) },
    command: { transform: (cb) => domains.command.transformEffect(cb) },
    pipeline: {
      hook: (name, handler) => domains.pipeline.transformEffect((ed) => ed.add({ name, handler })),
    },
  };
}

export function flushAllDomainStates(domains: PluginDomainStates): void {
  domains.language.get();
  domains.extractor.get();
  domains.linker.get();
  domains.rule.get();
  domains.query.get();
  domains.diagram.get();
  domains.studio.get();
  domains.showMe.get();
  domains.ci.get();
  domains.command.get();
  domains.pipeline.get();
}
