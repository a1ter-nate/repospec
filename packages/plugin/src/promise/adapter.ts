import { Effect, Scope } from "effect";
import type {
  EffectPluginContext,
  EffectPluginDefinition,
  EffectRegistration,
  PluginContext,
  PluginRegistration,
  PromisePluginDefinition,
  PromiseTransformDomain,
  EffectTransformDomain,
} from "../domains.ts";

function bridgeDomain<TEditor>(
  domain: EffectTransformDomain<TEditor>,
  scope: Scope.Scope,
  provideRuntime: <A, E>(eff: Effect.Effect<A, E, Scope.Scope>) => Promise<A>,
): PromiseTransformDomain<TEditor> {
  return {
    transform: async (cb: (editor: TEditor) => void): Promise<PluginRegistration> => {
      const reg: EffectRegistration = await provideRuntime(domain.transform(cb).pipe(Effect.provideService(Scope.Scope, scope)));
      return {
        dispose: () => provideRuntime(reg.dispose.pipe(Effect.provideService(Scope.Scope, scope))),
      };
    },
  };
}

export function fromPromise(def: PromisePluginDefinition): EffectPluginDefinition<Scope.Scope> {
  return {
    _tag: "EffectPlugin",
    id: def.id,
    guarded: def.guarded,
    effect: (effectCtx: EffectPluginContext) =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const env = yield* Effect.context<never>();
        const runScoped = <A, E>(eff: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
          Effect.runPromise(eff.pipe(Effect.provide(env), Effect.provideService(Scope.Scope, scope)));

        const promiseCtx: PluginContext = {
          options: effectCtx.options,
          language: bridgeDomain(effectCtx.language, scope, runScoped),
          extractor: bridgeDomain(effectCtx.extractor, scope, runScoped),
          linker: bridgeDomain(effectCtx.linker, scope, runScoped),
          rule: bridgeDomain(effectCtx.rule, scope, runScoped),
          query: bridgeDomain(effectCtx.query, scope, runScoped),
          diagram: bridgeDomain(effectCtx.diagram, scope, runScoped),
          studio: bridgeDomain(effectCtx.studio, scope, runScoped),
          showMe: bridgeDomain(effectCtx.showMe, scope, runScoped),
          ci: bridgeDomain(effectCtx.ci, scope, runScoped),
          command: bridgeDomain(effectCtx.command, scope, runScoped),
          pipeline: {
            hook: async (name, handler) => {
              const reg = await runScoped(effectCtx.pipeline.hook(name, handler));
              return {
                dispose: () => runScoped(reg.dispose.pipe(Effect.provideService(Scope.Scope, scope))),
              };
            },
          },
        };

        const cleanup = yield* Effect.tryPromise({
          try: () => Promise.resolve(def.setup(promiseCtx)),
          catch: (cause) => cause,
        });

        if (typeof cleanup === "function") {
          yield* Scope.addFinalizer(
            scope,
            Effect.promise(() => Promise.resolve(cleanup())).pipe(Effect.ignore),
          );
        }
      }),
  };
}
