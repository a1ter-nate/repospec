import { perfPlugin } from "@repospec/perf";
import type { AnyPluginDefinition } from "@repospec/plugin";
import { archPlugin } from "@repospec/plugin-arch";
import { ciPlugin } from "@repospec/plugin-ci";
import { flowsPlugin } from "@repospec/plugin-flows";
import { iacPlugin } from "@repospec/plugin-iac";
import { langCsharpPlugin } from "@repospec/plugin-lang-csharp";
import { langPythonPlugin } from "@repospec/plugin-lang-python";
import { langRustPlugin } from "@repospec/plugin-lang-rust";
import { langTypescriptPlugin } from "@repospec/plugin-lang-typescript";
import { moduleAtlasPlugin } from "@repospec/plugin-module-atlas";
import { passportPlugin } from "@repospec/plugin-passport";
import { sdkGenPlugin } from "@repospec/plugin-sdk-gen";
import { showMePlugin } from "@repospec/plugin-show-me";
import { studioPlugin } from "@repospec/plugin-studio";
import { surfacesPlugin } from "@repospec/plugin-surfaces";
import { testingPlugin } from "@repospec/plugin-testing";
import { corePolicyPlugin } from "./policy.ts";

export const guarded: ReadonlySet<string> = new Set<string>([corePolicyPlugin.id]);

export function getBuiltinManifest(): {
  readonly pre: readonly AnyPluginDefinition[];
  readonly post: readonly AnyPluginDefinition[];
  readonly guarded: ReadonlySet<string>;
} {
  const pre: readonly AnyPluginDefinition[] = [
    archPlugin,
    langTypescriptPlugin,
    langPythonPlugin,
    langRustPlugin,
    langCsharpPlugin,
    ciPlugin,
    testingPlugin,
    iacPlugin,
    surfacesPlugin,
    flowsPlugin,
    perfPlugin,
    moduleAtlasPlugin,
    passportPlugin,
    sdkGenPlugin,
    studioPlugin,
    showMePlugin,
  ];
  const post: readonly AnyPluginDefinition[] = [corePolicyPlugin];
  return { pre, post, guarded };
}
