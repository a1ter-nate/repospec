import { z } from "zod";

export const DomainSchema = z.enum(["arch", "ci", "test", "iac", "rules"]);
export type Domain = z.infer<typeof DomainSchema>;

const EcosystemSchema = z.enum(["typescript", "javascript", "rust", "python", "csharp", "polyglot"]);
export type Ecosystem = z.infer<typeof EcosystemSchema>;

const CapabilityTagSchema = z.enum(["FS", "DB", "HTTP", "PROC", "ENV", "PURE"]);
export type CapabilityTag = z.infer<typeof CapabilityTagSchema>;

const ExportedSymbolSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["function", "class", "type", "const", "command", "route"]),
  file: z.string().min(1),
  line: z.number().int().positive(),
});
export type ExportedSymbol = z.infer<typeof ExportedSymbolSchema>;

const ModuleRoleSchema = z.enum(["entry", "orchestrator", "core", "adapter", "foundation", "standalone"]);
export type ModuleRole = z.infer<typeof ModuleRoleSchema>;

const ModuleDepthSchema = z.enum(["deep", "balanced", "shallow", "contract"]);
export type ModuleDepth = z.infer<typeof ModuleDepthSchema>;

const ModuleFileEntrySchema = z.object({
  file: z.string().min(1),
  lines: z.number().int().nonnegative(),
  exports: z.number().int().nonnegative(),
  capabilities: z.array(CapabilityTagSchema),
});
export type ModuleFileEntry = z.infer<typeof ModuleFileEntrySchema>;

const ModuleCardSchema = z.object({
  id: z.string().min(1),
  unitId: z.string().min(1),
  unitName: z.string().min(1),
  unitSlug: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["file", "directory"]),
  relPath: z.string().min(1),
  language: z.string().min(1),
  level: z.number().int().nonnegative(),
  role: ModuleRoleSchema,
  depth: ModuleDepthSchema,
  fileCount: z.number().int().nonnegative(),
  lines: z.number().int().nonnegative(),
  exportCount: z.number().int().nonnegative(),
  fanIn: z.number().int().nonnegative(),
  fanOut: z.number().int().nonnegative(),
  inTangle: z.boolean(),
  tangleId: z.string().nullable(),
  hasSubsystemDiagram: z.boolean(),
  capabilities: z.array(CapabilityTagSchema),
  topExports: z.array(ExportedSymbolSchema),
  files: z.array(ModuleFileEntrySchema),
});
export type ModuleCard = z.infer<typeof ModuleCardSchema>;

const StorageModeSchema = z.enum(["artifact", "commit"]);
export type StorageMode = z.infer<typeof StorageModeSchema>;

const IacPlaneSchema = z.enum([
  "network",
  "compute",
  "data",
  "security",
  "observability",
  "messaging",
  "governance",
  "ci_infra",
]);
export type IacPlane = z.infer<typeof IacPlaneSchema>;

const RungSchema = z.enum(["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"]);
export type Rung = z.infer<typeof RungSchema>;

const CanonicalLayerSchema = z.enum([
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
export type CanonicalLayer = z.infer<typeof CanonicalLayerSchema>;

const LayerAxisSchema = z.enum(["pipeline", "integration", "foundation"]);
export type LayerAxis = z.infer<typeof LayerAxisSchema>;

const UnitArchetypeSchema = z.enum([
  "http_service",
  "frontend_app",
  "library_crate",
  "cli_worker",
  "analyzer_plugin",
  "test_suite",
]);
export type UnitArchetype = z.infer<typeof UnitArchetypeSchema>;

const LayerPolicySchema = z.enum([
  "layered_backend",
  "layered_frontend",
  "layered_clean_arch",
  "flat_library",
]);
export type LayerPolicy = z.infer<typeof LayerPolicySchema>;

const NodeRoleSchema = z.enum([
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
export type NodeRole = z.infer<typeof NodeRoleSchema>;

const ProvenanceSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const NodeKindSchema = z.enum([
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
export type NodeKind = z.infer<typeof NodeKindSchema>;

export const EdgeKindSchema = z.enum([
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
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

const EdgeEvidenceItemSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  detail: z.string().min(1),
});
export type EdgeEvidenceItem = z.infer<typeof EdgeEvidenceItemSchema>;

const NodeFindingSummarySchema = z.object({
  ruleId: z.string().min(1),
  severity: z.enum(["error", "warn", "info"]),
  count: z.number().int().positive(),
});
export type NodeFindingSummary = z.infer<typeof NodeFindingSummarySchema>;

const SpecNodeSchema = z.object({
  id: z.string().min(1),
  domain: DomainSchema,
  kind: NodeKindSchema,
  role: NodeRoleSchema.optional(),
  label: z.string().min(1),
  group: z.string().min(1).optional(),
  ownerId: z.string().min(1).optional(),
  provenance: ProvenanceSchema,
  tags: z.array(z.string()).default([]),
  findings: z.array(NodeFindingSummarySchema).optional(),
  meta: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]))
    .default({}),
});
export type SpecNode = z.infer<typeof SpecNodeSchema>;

const SpecEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: EdgeKindSchema,
  label: z.string().optional(),
  weight: z.number().int().positive().optional(),
  violation: z.boolean().optional(),
  ruleIds: z.array(z.string()).optional(),
  confidence: z.enum(["observed", "inferred"]).default("observed"),
  provenance: ProvenanceSchema.optional(),
  evidence: z.array(EdgeEvidenceItemSchema).optional(),
});
export type SpecEdge = z.infer<typeof SpecEdgeSchema>;

const RuleEnforcementSchema = z.enum(["static", "executed", "ci_gate", "ownership", "sql_invariant"]);
export type RuleEnforcement = z.infer<typeof RuleEnforcementSchema>;

const SpecRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["boundary", "quality_gate", "ownership", "lint_ratchet", "security_rule", "sql_invariant"]),
  enforcement: RuleEnforcementSchema,
  rung: RungSchema,
  statement: z.string().min(1),
  targets: z.array(z.string()).default([]),
  provenance: ProvenanceSchema,
});
export type SpecRule = z.infer<typeof SpecRuleSchema>;

const EvidenceAnchorSchema = z.object({
  diagramId: z.string().min(1),
  nodeIds: z.array(z.string()),
  edgeIds: z.array(z.string()),
});
export type EvidenceAnchor = z.infer<typeof EvidenceAnchorSchema>;

const InvariantEvidenceSchema = z.object({
  subject: z.string().min(1),
  detail: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  targetNodeId: z.string().optional(),
  edgeFromId: z.string().optional(),
  edgeToId: z.string().optional(),
  edgeKind: z.string().optional(),
  anchors: z.array(EvidenceAnchorSchema).optional(),
});
export type InvariantEvidence = z.infer<typeof InvariantEvidenceSchema>;

const SqlInvariantResultSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rung: RungSchema,
  severity: z.enum(["error", "warn", "info"]),
  status: z.enum(["pass", "warn", "fail", "na"]),
  applicabilityReason: z.string().optional(),
  sqlFile: z.string().min(1),
  statement: z.string().min(1),
  why: z.string().min(1),
  fix: z.string().min(1),
  violationCount: z.number().int().nonnegative(),
  evidence: z.array(InvariantEvidenceSchema),
});
export type SqlInvariantResult = z.infer<typeof SqlInvariantResultSchema>;

const EntityOwnershipSchema = z.object({
  datastore: z.string().min(1),
  entity: z.string().min(1),
  declared: z.boolean(),
  authorizedShared: z.boolean(),
  totalRefs: z.number().int().nonnegative(),
  layers: z.array(z.string()),
  domains: z.array(z.string()),
  hasBypass: z.boolean(),
  fkCount: z.number().int().nonnegative().default(0),
  hasTenancyKey: z.boolean().default(false),
  sampleFiles: z.array(z.string()),
});
export type EntityOwnership = z.infer<typeof EntityOwnershipSchema>;

const StateMachineTransitionSchema = z.object({
  from: z.string().min(1),
  event: z.string().min(1),
  to: z.string().min(1),
  guard: z.string().optional(),
});

const StateMachineRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  language: z.string().min(1),
  unit: z.string().min(1),
  evidence: z.enum(["declared", "inferred"]),
  states: z.array(z.string()),
  transitions: z.array(StateMachineTransitionSchema),
  provenance: ProvenanceSchema,
});
export type StateMachineRecord = z.infer<typeof StateMachineRecordSchema>;

const LoopRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["cron", "scheduler", "interval", "background_service", "webhook", "queue_consumer"]),
  schedule: z.string().nullable(),
  unit: z.string().min(1),
  provenance: ProvenanceSchema,
});
export type LoopRecord = z.infer<typeof LoopRecordSchema>;

export const PRIMITIVE_SCHEMAS = {
  EcosystemSchema,
  ModuleCardSchema,
  StorageModeSchema,
  IacPlaneSchema,
  RungSchema,
  CanonicalLayerSchema,
  LayerAxisSchema,
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
} as const;
