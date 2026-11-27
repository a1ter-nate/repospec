import { Cause, Effect, Exit, Scope } from "effect";
import { State, type RegistrationGroup } from "../state.ts";
import { createEffectPluginContext, flushAllDomainStates, type PluginDomainStates } from "./domains.ts";
import { getBuiltinManifest } from "./internal.ts";
import { loadExternalPluginTarget, normalizePluginDefinition } from "./module.ts";
import type { NormalizedPlugin, PluginOperation, PluginSource, PluginStatusEntry } from "./types.ts";

interface ActiveSlot {
  readonly plugin: NormalizedPlugin;
  readonly scope?: Scope.Closeable;
  readonly group?: RegistrationGroup;
  failure?: string;
}

function matchesSelector(selector: string, id: string): boolean {
  if (selector === "*") return true;
  if (selector.endsWith(".*")) return id.startsWith(selector.slice(0, -1));
  return selector === id;
}

export interface PluginSupervisorHandle {
  readonly list: () => readonly PluginStatusEntry[];
  readonly activate: (
    userPlugins: readonly unknown[],
    operations?: readonly PluginOperation[],
  ) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

async function loadSingleSlot(
  plugin: NormalizedPlugin,
  domains: PluginDomainStates,
  options: Record<string, unknown>,
): Promise<ActiveSlot> {
  const scope = await Effect.runPromise(Scope.make());
  const slot: ActiveSlot = { plugin, scope };
  const grp = State.createGroup((failure, refresh) => {
    const msg = failure.cause instanceof Error ? failure.cause.message : String(failure.cause);
    slot.failure = `Plugin disabled after ${failure.state}.transform failed: ${msg}`;
    refresh();
  });
  const fullSlot: ActiveSlot = { ...slot, group: grp };
  const ctx = createEffectPluginContext(domains, options);
  const exit = await Effect.runPromise(
    Effect.suspend(() => plugin.effect(ctx)).pipe(
      State.groupWith(grp),
      Effect.provideService(Scope.Scope, scope),
      Effect.exit,
    ),
  );
  if (Exit.isFailure(exit)) {
    const errText = Cause.pretty(exit.cause);
    State.detachGroup(grp, { state: "setup", cause: errText });
    fullSlot.failure = slot.failure ?? errText;
    await Effect.runPromise(State.closeGroupScope(scope).pipe(Effect.ignore));
    return fullSlot;
  }
  if (slot.failure) {
    fullSlot.failure = slot.failure;
    await Effect.runPromise(State.closeGroupScope(scope).pipe(Effect.ignore));
    return fullSlot;
  }
  return fullSlot;
}

async function resolveActivatedPlugins(params: {
  readonly includeBuiltins: boolean;
  readonly userPlugins: readonly unknown[];
  readonly operations: readonly PluginOperation[];
  readonly manifest: ReturnType<typeof getBuiltinManifest>;
  readonly loadFailures: PluginStatusEntry[];
}): Promise<NormalizedPlugin[]> {
  const { includeBuiltins, userPlugins, operations, manifest, loadFailures } = params;
  const preList: NormalizedPlugin[] = includeBuiltins
    ? manifest.pre
        .map((p) => normalizePluginDefinition(p, { type: "builtin" }, manifest.guarded))
        .filter((p): p is NormalizedPlugin => p !== null)
    : [];
  const postList: NormalizedPlugin[] = includeBuiltins
    ? manifest.post
        .map((p) => normalizePluginDefinition(p, { type: "builtin" }, manifest.guarded))
        .filter((p): p is NormalizedPlugin => p !== null)
    : [];
  const sdkList: NormalizedPlugin[] = userPlugins
    .map((p) => normalizePluginDefinition(p, { type: "sdk" }, manifest.guarded))
    .filter((p): p is NormalizedPlugin => p !== null);

  const enabled = new Set<string>([
    ...preList.map((p) => p.id),
    ...sdkList.map((p) => p.id),
    ...postList.map((p) => p.id),
  ]);
  const externalPackages = new Map<string, NormalizedPlugin>();
  const allKnown = (): NormalizedPlugin[] => [...preList, ...sdkList, ...externalPackages.values(), ...postList];

  for (const op of operations) {
    if (op.type === "remove") {
      for (const p of allKnown()) {
        if (matchesSelector(op.target, p.id) && !p.guarded && !manifest.guarded.has(p.id)) enabled.delete(p.id);
      }
      continue;
    }
    const matched = allKnown().filter((p) => matchesSelector(op.target, p.id));
    const isSelector =
      matched.length > 0 || op.target === "*" || op.target.endsWith(".*") || op.target.startsWith("repospec.");
    if (isSelector) {
      for (const p of matched) enabled.add(p.id);
      continue;
    }
    const loaded = await loadExternalPluginTarget(op.target, manifest.guarded);
    if (!loaded.ok) {
      loadFailures.push({
        id: op.target,
        source: loaded.source,
        status: "failed",
        state: { status: "failed", error: loaded.error },
        guarded: false,
        error: loaded.error,
      });
      continue;
    }
    externalPackages.set(op.target, loaded.plugin);
    enabled.add(loaded.plugin.id);
  }

  const ordered = [
    ...preList.filter((p) => enabled.has(p.id)),
    ...sdkList.filter((p) => enabled.has(p.id)),
    ...Array.from(externalPackages.values()).filter((p) => enabled.has(p.id)),
    ...postList.filter((p) => enabled.has(p.id)),
  ];

  const seen = new Set<string>();
  const deduped: NormalizedPlugin[] = [];
  for (const plugin of ordered) {
    if (seen.has(plugin.id)) {
      loadFailures.push({
        id: plugin.id,
        source: plugin.source,
        status: "failed",
        state: { status: "failed", error: `Duplicate plugin ID: ${plugin.id}` },
        guarded: plugin.guarded,
        error: `Duplicate plugin ID: ${plugin.id}`,
      });
      continue;
    }
    seen.add(plugin.id);
    deduped.push(plugin);
  }
  return deduped;
}

function buildStatusList(
  slots: Map<string, ActiveSlot>,
  loadFailures: readonly PluginStatusEntry[],
): readonly PluginStatusEntry[] {
  const out: PluginStatusEntry[] = [];
  for (const slot of slots.values()) {
    const failed = Boolean(slot.failure || slot.group?.failed);
    const errMsg = slot.failure ?? (slot.group?.failed ? "Plugin transform failed" : undefined);
    const source: PluginSource = slot.plugin.source;
    out.push(
      errMsg
        ? {
            id: slot.plugin.id,
            source,
            status: failed ? "failed" : "active",
            state: failed ? { status: "failed", error: errMsg } : { status: "active" },
            guarded: slot.plugin.guarded,
            error: errMsg,
          }
        : {
            id: slot.plugin.id,
            source,
            status: failed ? "failed" : "active",
            state: failed ? { status: "failed" } : { status: "active" },
            guarded: slot.plugin.guarded,
          },
    );
  }
  return [...out, ...loadFailures];
}

export function createPluginSupervisor(params: {
  readonly domains: PluginDomainStates;
  readonly includeBuiltins: boolean;
  readonly options: Record<string, unknown>;
}): PluginSupervisorHandle {
  const slots = new Map<string, ActiveSlot>();
  const loadFailures: PluginStatusEntry[] = [];
  const manifest = getBuiltinManifest();

  const teardownAll = async (): Promise<void> => {
    const raw = Array.from(slots.values());
    const vals: ActiveSlot[] = [];
    for (let i = raw.length - 1; i >= 0; i -= 1) {
      const item = raw[i];
      if (item) vals.push(item);
    }
    slots.clear();
    loadFailures.length = 0;
    await Effect.runPromise(
      State.batch(
        Effect.forEach(
          vals,
          (slot) => (slot.scope ? State.closeGroupScope(slot.scope).pipe(Effect.ignore) : Effect.void),
          { concurrency: 1, discard: true },
        ),
      ),
    );
  };

  const activate = async (
    userPlugins: readonly unknown[],
    operations: readonly PluginOperation[] = [],
  ): Promise<void> => {
    await teardownAll();
    const deduped = await resolveActivatedPlugins({
      includeBuiltins: params.includeBuiltins,
      userPlugins,
      operations,
      manifest,
      loadFailures,
    });
    for (const plugin of deduped) {
      slots.set(plugin.id, await loadSingleSlot(plugin, params.domains, params.options));
    }
    flushAllDomainStates(params.domains);
    for (const slot of slots.values()) {
      if (slot.group?.failed && !slot.failure) slot.failure = "Plugin detached after state transform failure";
      if (slot.failure && slot.scope) {
        await Effect.runPromise(State.closeGroupScope(slot.scope).pipe(Effect.ignore));
      }
    }
  };

  return {
    list: () => buildStatusList(slots, loadFailures),
    activate,
    dispose: teardownAll,
  };
}
