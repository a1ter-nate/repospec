import type { buildVerificationScopeSummary, DrilldownIndex, EffectPluginDefinition, RepoSpecV4 } from "@repospec/plugin";
import type { Scope as EffectScope } from "effect";

export type PluginSource =
  | { readonly type: "builtin" }
  | { readonly type: "sdk" }
  | { readonly type: "package"; readonly target: string }
  | { readonly type: "file"; readonly target: string };

export interface PluginStatusEntry {
  readonly id: string;
  readonly source: PluginSource;
  readonly status: "active" | "failed";
  readonly state: { readonly status: "active" | "failed"; readonly error?: string };
  readonly guarded: boolean;
  readonly error?: string;
}

export interface PluginOperation {
  readonly type: "add" | "remove";
  readonly target: string;
}

export interface NormalizedPlugin {
  readonly id: string;
  readonly guarded: boolean;
  readonly source: PluginSource;
  readonly effect: EffectPluginDefinition<EffectScope.Scope>["effect"];
}

export interface PluginHostOptions {
  readonly repoDir?: string;
  readonly plugins?: readonly unknown[];
  readonly operations?: readonly PluginOperation[];
  readonly includeBuiltins?: boolean;
  readonly options?: Record<string, unknown>;
}

export interface PluginScanResult {
  readonly spec: RepoSpecV4;
  readonly digest: string;
  readonly idsModule: string;
  readonly sdkModule: string;
  readonly dbPath: string;
  readonly drilldown: DrilldownIndex;
  readonly repoExtensions: unknown;
}

export interface PluginCheckResult {
  readonly ok: boolean;
  readonly drifted: boolean;
  readonly digest: string;
  readonly errorDiagnostics: readonly { readonly code: string; readonly severity: string; readonly message: string }[];
  readonly failedInvariants: readonly { readonly id: string; readonly name: string; readonly count: number }[];
  readonly customGates: readonly {
    readonly id: string;
    readonly name: string;
    readonly severity: "error" | "warn";
    readonly passed: boolean;
    readonly message: string;
    readonly items: readonly string[];
  }[];
  readonly scopeSummary: ReturnType<typeof buildVerificationScopeSummary>;
  readonly soundiness?: RepoSpecV4["soundiness"];
  readonly verification: RepoSpecV4["verification"];
}

export interface PluginHostInstance {
  readonly list: () => readonly PluginStatusEntry[];
  readonly activate: (
    plugins: readonly unknown[],
    operations?: readonly PluginOperation[],
  ) => Promise<void>;
  readonly dispose: () => Promise<void>;
  readonly scan: (
    repoDir: string,
    opts?: { readonly dbPath?: string; readonly storageMode?: "artifact" | "commit" | "committed" },
  ) => Promise<PluginScanResult>;
  readonly renderStudio: (scanResult: unknown) => string;
  readonly check: (
    repoDir: string,
    opts?: { readonly specPath?: string; readonly allowFail?: boolean },
  ) => Promise<PluginCheckResult>;
}
