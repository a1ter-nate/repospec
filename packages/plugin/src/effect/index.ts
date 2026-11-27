import type { Scope } from "effect";
import type { EffectPluginContext, EffectPluginDefinition } from "../domains.ts";
import { fromPromise } from "../promise/adapter.ts";

export type {
  AnyPluginDefinition,
  CiEditor,
  CiGateItem,
  CommandItem,
  DiagramProviderItem,
  DomainEditor,
  EffectPluginContext,
  EffectPluginDefinition,
  EffectRegistration,
  ExtractorItem,
  LanguageItem,
  LinkerItem,
  PipelineHookHandler,
  PipelineHookName,
  PluginContext,
  PluginRegistration,
  PromisePluginDefinition,
  QueryItem,
  RuleItem,
  ShowMeEditor,
  ShowMeTriageFn,
  StudioEditor,
  StudioRenderContribution,
  StudioTabItem,
} from "../domains.ts";

export { fromPromise };

export function defineEffect<R = Scope.Scope>(
  plugin: Omit<EffectPluginDefinition<R>, "_tag">,
): EffectPluginDefinition<R> {
  return {
    _tag: "EffectPlugin",
    id: plugin.id,
    guarded: plugin.guarded,
    effect: plugin.effect,
  };
}

export const Plugin = {
  define: defineEffect,
  fromPromise,
};

export type Context = EffectPluginContext;
