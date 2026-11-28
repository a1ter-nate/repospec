import { Effect, Schema } from "effect";

export type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T;

export const DomainSchema = Schema.Literals(["arch", "ci", "test", "iac", "rules"]);
export type Domain = typeof DomainSchema.Type;

const EcosystemSchema = Schema.Literals(["typescript", "javascript", "rust", "python", "csharp", "polyglot"]);
export type Ecosystem = typeof EcosystemSchema.Type;

const CapabilityTagSchema = Schema.Literals(["FS", "DB", "HTTP", "PROC", "ENV", "PURE"]);
export type CapabilityTag = typeof CapabilityTagSchema.Type;

const NonNegInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const PosInt = Schema.Int.check(Schema.isGreaterThan(0));

const ExportedSymbolSchema = Schema.Struct({
  name: Schema.NonEmptyString,
  kind: Schema.Literals(["function", "class", "type", "const", "command", "route"]),
  file: Schema.NonEmptyString,
  line: PosInt,
});
export type ExportedSymbol = DeepMutable<typeof ExportedSymbolSchema.Type>;

const ModuleRoleSchema = Schema.Literals(["entry", "orchestrator", "core", "adapter", "foundation", "standalone"]);
export type ModuleRole = typeof ModuleRoleSchema.Type;

const ModuleDepthSchema = Schema.Literals(["deep", "balanced", "shallow", "contract"]);
export type ModuleDepth = typeof ModuleDepthSchema.Type;

const ModuleFileEntrySchema = Schema.Struct({
  file: Schema.NonEmptyString,
  lines: NonNegInt,
  exports: NonNegInt,
  capabilities: Schema.Array(CapabilityTagSchema),
});
export type ModuleFileEntry = DeepMutable<typeof ModuleFileEntrySchema.Type>;

const ModuleCardSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  unitId: Schema.NonEmptyString,
  unitName: Schema.NonEmptyString,
  unitSlug: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  kind: Schema.Literals(["file", "directory"]),
  relPath: Schema.NonEmptyString,
  language: Schema.NonEmptyString,
  level: NonNegInt,
  role: ModuleRoleSchema,
  depth: ModuleDepthSchema,
  fileCount: NonNegInt,
  lines: NonNegInt,
  exportCount: NonNegInt,
  fanIn: NonNegInt,
  fanOut: NonNegInt,
  inTangle: Schema.Boolean,
  tangleId: Schema.NullOr(Schema.String),
  hasSubsystemDiagram: Schema.Boolean,
  capabilities: Schema.Array(CapabilityTagSchema),
  topExports: Schema.Array(ExportedSymbolSchema),
  files: Schema.Array(ModuleFileEntrySchema),
  cd: Schema.optional(NonNegInt),
  instability: Schema.optional(Schema.Finite),
  abstractness: Schema.optional(Schema.Finite),
  mainSeqDistance: Schema.optional(Schema.Finite),
  corePeriphery: Schema.optional(Schema.Literals(["core", "periphery", "isolated"])),
  relativeChurn: Schema.optional(Schema.Finite),
  hotspotScore: Schema.optional(Schema.Finite),
  contractionBlastRadius: Schema.optional(NonNegInt),
});
export type ModuleCard = DeepMutable<typeof ModuleCardSchema.Type>;

const StorageModeSchema = Schema.Literals(["artifact", "commit"]);
export type StorageMode = typeof StorageModeSchema.Type;

const IacPlaneSchema = Schema.Literals([
  "network",
  "compute",
  "data",
  "security",
  "observability",
  "messaging",
  "governance",
  "ci_infra",
]);
export type IacPlane = typeof IacPlaneSchema.Type;

const RungSchema = Schema.Literals(["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"]);
export type Rung = typeof RungSchema.Type;

const CanonicalLayerSchema = Schema.Literals([
  "transport",
  "orchestration",
  "domain",
  "persistence",
  "integration",
  "ui",
  "runtime_loop",
  "analyzer",
  "ops_script",
  "support",
  "tests",
  "unclassified",
]);
export type CanonicalLayer = typeof CanonicalLayerSchema.Type;

const LayerAxisSchema = Schema.Literals(["pipeline", "integration", "foundation"]);
export type LayerAxis = typeof LayerAxisSchema.Type;

const UnitArchetypeSchema = Schema.Literals([
  "http_service",
  "frontend_app",
  "library_crate",
  "cli_worker",
  "analyzer_plugin",
  "test_suite",
]);
export type UnitArchetype = typeof UnitArchetypeSchema.Type;

const LayerPolicySchema = Schema.Literals([
  "layered_backend",
  "layered_frontend",
  "layered_clean_arch",
  "flat_library",
]);
export type LayerPolicy = typeof LayerPolicySchema.Type;

const NodeRoleSchema = Schema.Literals([
  "client",
  "ingress",
  "service",
  "library",
  "datastore",
  "external",
  "analyzer",
  "test",
  "ci",
  "iac",
  "rule",
  "layer",
  "domain",
  "module",
]);
export type NodeRole = typeof NodeRoleSchema.Type;

const ProvenanceSchema = Schema.Struct({
  file: Schema.NonEmptyString,
  line: Schema.optional(PosInt),
});
export type Provenance = DeepMutable<typeof ProvenanceSchema.Type>;

export const NodeKindSchema = Schema.Literals([
  "app",
  "package",
  "test_package",
  "native_app",
  "analyzer",
  "code_layer",
  "domain_area",
  "datastore",
  "external_service",
  "state_machine",
  "loop_runner",
  "workflow",
  "ci_job",
  "test_suite",
  "iac_resource",
  "iac_container",
  "iac_datastore_rule",
  "quality_gate",
  "boundary_policy",
  "ownership_rule",
  "linter_config",
]);
export type NodeKind = typeof NodeKindSchema.Type;

export const EdgeKindSchema = Schema.Literals([
  "depends_on",
  "analyzes",
  "imports_layer",
  "imports_domain",
  "reads_writes",
  "calls_external",
  "routes_to",
  "bypasses_layer",
  "triggers",
  "contains",
  "verifies",
  "deploys",
  "builds_image",
  "governs",
  "enforces_in_ci",
  "references",
  "denies_dependency",
]);
export type EdgeKind = typeof EdgeKindSchema.Type;

const EdgeEvidenceItemSchema = Schema.Struct({
  file: Schema.NonEmptyString,
  line: Schema.optional(PosInt),
  detail: Schema.NonEmptyString,
});
export type EdgeEvidenceItem = DeepMutable<typeof EdgeEvidenceItemSchema.Type>;

const NodeFindingSummarySchema = Schema.Struct({
  ruleId: Schema.NonEmptyString,
  severity: Schema.Literals(["error", "warn", "info"]),
  count: PosInt,
});
export type NodeFindingSummary = DeepMutable<typeof NodeFindingSummarySchema.Type>;

const MetaValueSchema = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Array(Schema.String),
  Schema.Null,
]);

type MetaValue = string | number | boolean | readonly string[] | null;

const SpecNodeSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  domain: DomainSchema,
  kind: NodeKindSchema,
  role: Schema.optional(NodeRoleSchema),
  label: Schema.NonEmptyString,
  group: Schema.optional(Schema.NonEmptyString),
  ownerId: Schema.optional(Schema.NonEmptyString),
  provenance: ProvenanceSchema,
  tags: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.sync(() => [] as readonly string[])),
  ),
  findings: Schema.optional(Schema.Array(NodeFindingSummarySchema)),
  meta: Schema.Record(Schema.String, MetaValueSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.sync(() => ({} as Record<string, MetaValue>))),
  ),
});
export type SpecNode = DeepMutable<typeof SpecNodeSchema.Type>;

const SpecEdgeSchema = Schema.Struct({
  from: Schema.NonEmptyString,
  to: Schema.NonEmptyString,
  kind: EdgeKindSchema,
  label: Schema.optional(Schema.String),
  weight: Schema.optional(PosInt),
  violation: Schema.optional(Schema.Boolean),
  ruleIds: Schema.optional(Schema.Array(Schema.String)),
  confidence: Schema.Literals(["observed", "inferred"]).pipe(
    Schema.withDecodingDefaultKey(Effect.sync(() => "observed" as const)),
  ),
  provenance: Schema.optional(ProvenanceSchema),
  evidence: Schema.optional(Schema.Array(EdgeEvidenceItemSchema)),
});
export type SpecEdge = DeepMutable<typeof SpecEdgeSchema.Type>;

const RuleEnforcementSchema = Schema.Literals(["static", "executed", "ci_gate", "ownership", "sql_invariant"]);
export type RuleEnforcement = typeof RuleEnforcementSchema.Type;

const SpecRuleSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  category: Schema.Literals(["boundary", "quality_gate", "ownership", "lint_ratchet", "security_rule", "sql_invariant"]),
  enforcement: RuleEnforcementSchema,
  rung: RungSchema,
  statement: Schema.NonEmptyString,
  targets: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.sync(() => [] as readonly string[])),
  ),
  provenance: ProvenanceSchema,
});
export type SpecRule = DeepMutable<typeof SpecRuleSchema.Type>;

const EvidenceAnchorSchema = Schema.Struct({
  diagramId: Schema.NonEmptyString,
  nodeIds: Schema.Array(Schema.String),
  edgeIds: Schema.Array(Schema.String),
});
export type EvidenceAnchor = DeepMutable<typeof EvidenceAnchorSchema.Type>;

const InvariantEvidenceSchema = Schema.Struct({
  subject: Schema.NonEmptyString,
  detail: Schema.NonEmptyString,
  file: Schema.NonEmptyString,
  line: Schema.optional(PosInt),
  targetNodeId: Schema.optional(Schema.String),
  edgeFromId: Schema.optional(Schema.String),
  edgeToId: Schema.optional(Schema.String),
  edgeKind: Schema.optional(Schema.String),
  anchors: Schema.optional(Schema.Array(EvidenceAnchorSchema)),
});
export type InvariantEvidence = DeepMutable<typeof InvariantEvidenceSchema.Type>;

const InvariantSourceSchema = Schema.Struct({
  label: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
});

const SqlInvariantResultSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  rung: RungSchema,
  severity: Schema.Literals(["error", "warn", "info"]),
  status: Schema.Literals(["pass", "warn", "fail", "na"]),
  applicabilityReason: Schema.optional(Schema.String),
  sqlFile: Schema.NonEmptyString,
  statement: Schema.NonEmptyString,
  why: Schema.NonEmptyString,
  fix: Schema.NonEmptyString,
  benefit: Schema.optional(Schema.String),
  sources: Schema.optional(Schema.Array(InvariantSourceSchema)),
  violationCount: NonNegInt,
  evidence: Schema.Array(InvariantEvidenceSchema),
});
export type SqlInvariantResult = DeepMutable<typeof SqlInvariantResultSchema.Type>;

const EntityOwnershipSchema = Schema.Struct({
  datastore: Schema.NonEmptyString,
  entity: Schema.NonEmptyString,
  declared: Schema.Boolean,
  authorizedShared: Schema.Boolean,
  totalRefs: NonNegInt,
  layers: Schema.Array(Schema.String),
  domains: Schema.Array(Schema.String),
  hasBypass: Schema.Boolean,
  fkCount: NonNegInt.pipe(Schema.withDecodingDefaultKey(Effect.sync(() => 0))),
  hasTenancyKey: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.sync(() => false))),
  sampleFiles: Schema.Array(Schema.String),
});
export type EntityOwnership = DeepMutable<typeof EntityOwnershipSchema.Type>;

const StateMachineTransitionSchema = Schema.Struct({
  from: Schema.NonEmptyString,
  event: Schema.NonEmptyString,
  to: Schema.NonEmptyString,
  guard: Schema.optional(Schema.String),
});

const StateMachineRecordSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  language: Schema.NonEmptyString,
  unit: Schema.NonEmptyString,
  evidence: Schema.Literals(["declared", "inferred"]),
  states: Schema.Array(Schema.String),
  transitions: Schema.Array(StateMachineTransitionSchema),
  provenance: ProvenanceSchema,
});
export type StateMachineRecord = DeepMutable<typeof StateMachineRecordSchema.Type>;

const LoopRecordSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  kind: Schema.Literals(["cron", "scheduler", "interval", "background_service", "webhook", "queue_consumer"]),
  schedule: Schema.NullOr(Schema.String),
  unit: Schema.NonEmptyString,
  provenance: ProvenanceSchema,
});
export type LoopRecord = DeepMutable<typeof LoopRecordSchema.Type>;

export const PRIMITIVE_SCHEMAS = {
  EcosystemSchema,
  ModuleCardSchema,
  StorageModeSchema,
  IacPlaneSchema,
  RungSchema,
  CanonicalLayerSchema,
  LayerAxisSchema,
  UnitArchetypeSchema,
  LayerPolicySchema,
  NodeRoleSchema,
  ProvenanceSchema,
  EdgeEvidenceItemSchema,
  NodeFindingSummarySchema,
  SpecNodeSchema,
  SpecEdgeSchema,
  SpecRuleSchema,
  SqlInvariantResultSchema,
  EntityOwnershipSchema,
  StateMachineRecordSchema,
  LoopRecordSchema,
  NonNegInt,
  PosInt,
} as const;
