import type {
  AsyncEndpointRef,
  AsyncHandoff,
  DeclarativeFlowAnchor,
  ExtractedStateMachine,
  WorkFlowRecord,
} from "./types.ts";

export interface RawFieldEvent {
  entity: string;
  field: string;
  kind: "writer" | "reader";
  fn: string;
  file: string;
  line: number;
  mode: "write" | "delete" | "tx";
  derived: boolean;
}

export interface RawAsyncEndpoint {
  role: "producer" | "consumer";
  channel: string;
  transport: AsyncHandoff["transport"];
  delivery: AsyncHandoff["delivery"];
  ref: AsyncEndpointRef;
}

export interface FlowLanguageFileContext {
  readonly repoDir: string;
  readonly relFile: string;
  readonly unitSlug: string;
  readonly text: string;
  readonly anchors: readonly DeclarativeFlowAnchor[];
}

export interface FlowLanguagePlugin {
  readonly id: string;
  readonly label: string;
  readonly extensions: readonly string[];
  readonly extractFlows?: (ctx: FlowLanguageFileContext) => WorkFlowRecord[];
  readonly extractFieldEvents?: (ctx: FlowLanguageFileContext) => RawFieldEvent[];
  readonly extractStateMachines?: (ctx: FlowLanguageFileContext) => ExtractedStateMachine[];
  readonly extractAsyncEndpoints?: (ctx: FlowLanguageFileContext) => RawAsyncEndpoint[];
}

export function defineFlowLanguage(plugin: FlowLanguagePlugin): FlowLanguagePlugin {
  return plugin;
}
