import type { PromisePluginDefinition } from "./domains.ts";
import { defineEffect } from "./effect/index.ts";
import { fromPromise } from "./promise/adapter.ts";

export { defineEffect, fromPromise };

export function definePlugin(def: PromisePluginDefinition): PromisePluginDefinition {
  return {
    _tag: "PromisePlugin",
    id: def.id,
    guarded: def.guarded,
    setup: def.setup,
  };
}

export const Plugin = {
  define: definePlugin,
  defineEffect,
  fromPromise,
};

export * from "./coverage.ts";
export * from "./domains.ts";
export * from "./errors.ts";
export * from "./moduleFacts.ts";
export * from "./schema.ts";
export * from "./specUtils.ts";
export * from "./taxonomy.ts";
