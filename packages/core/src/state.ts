import { Context, Effect, Exit, Scope } from "effect";

export type TransformCallback<TEditor> = (editor: TEditor) => void;
export type MakeEditor<TState, TEditor> = (state: TState) => TEditor;

export interface SyncRegistration {
  readonly dispose: () => void;
}

export interface StateFailure {
  readonly state: string;
  readonly cause: unknown;
}

interface GroupedRegistration {
  readonly remove: () => boolean;
  readonly notify: () => void;
}

export interface RegistrationGroup {
  failed: boolean;
  readonly registrations: Set<GroupedRegistration>;
  readonly report: (failure: StateFailure, refresh: () => void) => void;
}

interface BatchState {
  active: boolean;
  readonly shutdown: boolean;
  readonly notifications: Set<() => void>;
}

const CurrentGroupRef = Context.Reference<RegistrationGroup | undefined>("@repospec/State/CurrentGroup", {
  defaultValue: () => undefined,
});

const CurrentBatchRef = Context.Reference<BatchState | undefined>("@repospec/State/CurrentBatch", {
  defaultValue: () => undefined,
});

let ambientGroup: RegistrationGroup | undefined;
let ambientBatch: BatchState | undefined;

function disableGroup(grp: RegistrationGroup, failure: StateFailure): void {
  if (grp.failed) return;
  grp.failed = true;
  const toNotify = new Set<() => void>();
  for (const reg of grp.registrations) {
    reg.remove();
    toNotify.add(reg.notify);
  }
  grp.registrations.clear();
  grp.report(failure, () => {
    for (const fn of toNotify) fn();
  });
}

function createGroup(report: RegistrationGroup["report"]): RegistrationGroup {
  return { failed: false, registrations: new Set(), report };
}

function detachGroup(grp: RegistrationGroup, failure: StateFailure): void {
  disableGroup(grp, failure);
}

function withAmbientGroup<T>(grp: RegistrationGroup | undefined, fn: () => T): T {
  const prev = ambientGroup;
  ambientGroup = grp;
  try {
    return fn();
  } finally {
    ambientGroup = prev;
  }
}

function group(report: RegistrationGroup["report"]): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> {
  const grp = createGroup(report);
  return <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provideService(effect, CurrentGroupRef, grp);
}

function groupWith(grp: RegistrationGroup): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> {
  return <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provideService(effect, CurrentGroupRef, grp);
}

function runBatchSync<T>(fn: () => T, isShutdown: boolean): T {
  if (ambientBatch?.active && !isShutdown) return fn();
  const b: BatchState = { active: true, shutdown: isShutdown, notifications: new Set() };
  const prev = ambientBatch;
  ambientBatch = b;
  try {
    return fn();
  } finally {
    b.active = false;
    ambientBatch = prev;
    if (!isShutdown) {
      for (const notify of b.notifications) notify();
    }
  }
}

function batch<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const current = yield* CurrentBatchRef;
      if (current?.active) return yield* restore(effect);
      const b: BatchState = { active: true, shutdown: false, notifications: new Set() };
      const exit = yield* restore(effect.pipe(Effect.provideService(CurrentBatchRef, b))).pipe(Effect.exit);
      b.active = false;
      for (const notify of b.notifications) notify();
      return yield* exit;
    }),
  );
}

function batchSync<T>(fn: () => T): T {
  return runBatchSync(fn, false);
}

function shutdown<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const b: BatchState = { active: true, shutdown: true, notifications: new Set() };
      const exit = yield* restore(effect.pipe(Effect.provideService(CurrentBatchRef, b))).pipe(Effect.exit);
      b.active = false;
      return yield* exit;
    }),
  );
}

function closeGroupScope(scope: Scope.Closeable): Effect.Effect<void> {
  return Scope.close(scope, Exit.void);
}

export interface StateOptions<TState, TEditor> {
  readonly name?: string;
  readonly initial: () => TState;
  readonly editor: MakeEditor<TState, TEditor>;
  readonly notify?: (state: TState) => void;
}

export interface StateInstance<TState, TEditor> {
  readonly get: () => TState;
  readonly invalidate: () => void;
  readonly revision: () => number;
  readonly reload: () => void;
  readonly transform: (cb: TransformCallback<TEditor>) => SyncRegistration;
  readonly transformEffect: (
    cb: TransformCallback<TEditor>,
  ) => Effect.Effect<{ readonly dispose: Effect.Effect<void> }, never, Scope.Scope>;
}

const MAX_REPLAY_ATTEMPTS = 64;

export function create<TState, TEditor>(options: StateOptions<TState, TEditor>): StateInstance<TState, TEditor> {
  let current = options.initial();
  const transforms = new Set<{ readonly run: TransformCallback<TEditor>; readonly grp: RegistrationGroup | undefined }>();
  let dirty = false;
  let closed = false;
  let version = 0;

  const invalidate = (): void => {
    dirty = true;
    version += 1;
  };

  const get = (): TState => {
    if (closed || !dirty) return current;
    for (let attempt = 0; attempt < MAX_REPLAY_ATTEMPTS; attempt += 1) {
      const started = version;
      const next = options.initial();
      const ed = options.editor(next);
      for (const entry of transforms) {
        try {
          entry.run(ed);
        } catch (cause) {
          if (!entry.grp) throw cause;
          disableGroup(entry.grp, { state: options.name ?? "anonymous", cause });
        }
        if (version !== started) break;
      }
      if (version !== started) continue;
      current = next;
      dirty = false;
      return current;
    }
    return current;
  };

  const runNotify = (): void => {
    if (closed) return;
    const val = get();
    if (options.notify) options.notify(val);
  };

  const markChanged = (activeBatch: BatchState | undefined): void => {
    if (closed) return;
    invalidate();
    if (activeBatch?.active) {
      if (activeBatch.shutdown) {
        closed = true;
        return;
      }
      activeBatch.notifications.add(runNotify);
      return;
    }
    runNotify();
  };

  const registerInternal = (
    cb: TransformCallback<TEditor>,
    grp: RegistrationGroup | undefined,
    activeBatch: BatchState | undefined,
  ): SyncRegistration => {
    if (grp?.failed) {
      return { dispose: () => undefined };
    }
    const entry = { run: cb, grp };
    const groupedReg: GroupedRegistration = {
      remove: () => {
        if (!transforms.delete(entry)) return false;
        grp?.registrations.delete(groupedReg);
        invalidate();
        return true;
      },
      notify: () => markChanged(activeBatch),
    };
    transforms.add(entry);
    grp?.registrations.add(groupedReg);
    markChanged(activeBatch);
    return {
      dispose: () => {
        if (groupedReg.remove()) markChanged(ambientBatch);
      },
    };
  };

  const transform = (cb: TransformCallback<TEditor>): SyncRegistration =>
    registerInternal(cb, ambientGroup, ambientBatch);

  const transformEffect = (
    cb: TransformCallback<TEditor>,
  ): Effect.Effect<{ readonly dispose: Effect.Effect<void> }, never, Scope.Scope> =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const grp = (yield* CurrentGroupRef) ?? ambientGroup;
      const activeBatch = (yield* CurrentBatchRef) ?? ambientBatch;
      const reg = registerInternal(cb, grp, activeBatch);
      const disposeEff = Effect.sync(() => {
        reg.dispose();
      });
      yield* Scope.addFinalizer(scope, disposeEff);
      return { dispose: disposeEff };
    });

  return {
    get,
    invalidate,
    revision: () => version,
    reload: () => markChanged(ambientBatch),
    transform,
    transformEffect,
  };
}

export const State = {
  create,
  batch,
  batchSync,
  group,
  groupWith,
  createGroup,
  detachGroup,
  withAmbientGroup,
  shutdown,
  closeGroupScope,
};
