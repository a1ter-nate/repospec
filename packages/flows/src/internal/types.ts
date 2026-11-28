export type FlowEffectKind =
  | "db_read"
  | "db_write"
  | "tx_commit"
  | "cache_read"
  | "cache_del"
  | "external_http"
  | "notify"
  | "async_enqueue"
  | "response_send"
  | "span"
  | "call";

export type FlowLane =
  | "client"
  | "handler"
  | "cache"
  | "datastore"
  | "external"
  | "async_push";

export type FlowHazardKind =
  | "notify_before_commit"
  | "invalidate_before_write"
  | "serial_independent_awaits"
  | "blocking_noncritical_io"
  | "write_on_poll"
  | "multi_writer_unowned_field"
  | "derived_state_sync"
  | "io_inside_transaction"
  | "non_idempotent_retry"
  | "unbounded_pagination";

export interface LdfiCutSetRecord {
  flowId: string;
  flowName: string;
  file: string;
  unit: string;
  cutSets: Array<{
    size: number;
    kind: "single_point_of_failure" | "redundant_group";
    steps: Array<{ index: number; fn: string; op: FlowEffectKind; lane: FlowLane; line: number }>;
  }>;
}

export interface FlowStep {
  index: number;
  fn: string;
  op: FlowEffectKind;
  lane: FlowLane;
  file: string;
  line: number;
  parallelGroup?: number;
  afterResponse: boolean;
  bestEffort: boolean;
  target?: string;
  latencyMsP50?: number;
  latencyMsP95?: number;
  rps?: number;
}

export interface FlowHazard {
  kind: FlowHazardKind;
  severity: "error" | "warn";
  file: string;
  line: number;
  subject: string;
  summary: string;
  stepIndexes: number[];
}

export interface WorkFlowRecord {
  id: string;
  name: string;
  entryFn?: string;
  triggerKind: "http" | "cron" | "trigger" | "span" | "journey";
  file: string;
  line: number;
  unit: string;
  steps: FlowStep[];
  responseStepIndex: number | null;
  commitStepIndex: number | null;
  serialAwaitCount: number;
  hazards: FlowHazard[];
  tags?: string[];
  telemetry?: {
    p50Ms?: number;
    p95Ms?: number;
    rps?: number;
  };
}

export interface EntityFieldWriter {
  fn: string;
  file: string;
  line: number;
  mode: "write" | "delete" | "tx";
}

export interface EntityFieldReader {
  fn: string;
  file: string;
  line: number;
  derived: boolean;
}

export interface EntityFieldLifecycle {
  entity: string;
  field: string;
  writers: EntityFieldWriter[];
  readers: EntityFieldReader[];
  derivedOnRead: boolean;
  multiWriterRisk: boolean;
}

export interface ExtractedStateTransition {
  from: string;
  to: string;
  event: string;
  guard?: string;
  effects?: string[];
}

export interface ExtractedStateMachine {
  id: string;
  name: string;
  file: string;
  line: number;
  unit: string;
  states: string[];
  transitions: ExtractedStateTransition[];
}

export interface AsyncEndpointRef {
  fn: string;
  file: string;
  line: number;
  language: string;
}

export interface AsyncHandoff {
  channel: string;
  transport: "fcm" | "pubsub" | "cloud_task" | "firestore_trigger" | "cron" | "webhook" | "queue";
  delivery: "best-effort" | "at-least-once" | "scheduled";
  producer: AsyncEndpointRef;
  consumer?: AsyncEndpointRef;
}

export interface DeclarativeFlowAnchor {
  id: string;
  name: string;
  entryFile: string;
  entryFn?: string;
  tags?: string[];
}

export interface TelemetryOverlayRecord {
  spanName?: string;
  file?: string;
  fn?: string;
  p50Ms?: number;
  p95Ms?: number;
  rps?: number;
}

export interface FlowAnalysisBundle {
  workFlows: WorkFlowRecord[];
  entityLifecycles: EntityFieldLifecycle[];
  stateMachines: ExtractedStateMachine[];
  asyncHandoffs: AsyncHandoff[];
  hazards: FlowHazard[];
  ldfiCutSets?: LdfiCutSetRecord[];
}
