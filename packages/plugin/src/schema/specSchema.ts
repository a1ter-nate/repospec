import { Effect, Schema } from "effect";
import { SchemaValidationError } from "../errors.ts";
import { DomainSchema, PRIMITIVE_SCHEMAS, type DeepMutable } from "./primitives.ts";

const {
  EcosystemSchema,
  ModuleCardSchema,
  StorageModeSchema,
  IacPlaneSchema,
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
  NonNegInt,
  PosInt,
} = PRIMITIVE_SCHEMAS;

const PctSchema = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100));

const LayoutPointSchema = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
});

const LayoutNodeSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  sublabel: Schema.optional(Schema.String),
  group: Schema.optional(Schema.String),
  lane: Schema.optional(Schema.String),
  layerAxis: Schema.optional(LayerAxisSchema),
  layerRank: Schema.optional(NonNegInt),
  kind: Schema.NonEmptyString,
  role: Schema.optional(NodeRoleSchema),
  domain: DomainSchema,
  shape: Schema.Literals(["box", "pill", "db", "hex"]),
  expandable: Schema.optional(Schema.Boolean),
  ambientBadges: Schema.optional(Schema.Array(Schema.String)),
  findings: Schema.optional(Schema.Array(NodeFindingSummarySchema)),
  x: Schema.Finite,
  y: Schema.Finite,
  w: Schema.Finite,
  h: Schema.Finite,
  provenance: Schema.optional(ProvenanceSchema),
});
export type LayoutNode = DeepMutable<typeof LayoutNodeSchema.Type>;

const LayoutEdgeSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  from: Schema.NonEmptyString,
  to: Schema.NonEmptyString,
  kind: Schema.NonEmptyString,
  tier: Schema.optional(Schema.Literals(["spine", "violation", "detail"])),
  label: Schema.optional(Schema.String),
  weight: Schema.optional(PosInt),
  violation: Schema.optional(Schema.Boolean),
  bidirectional: Schema.optional(Schema.Boolean),
  confidence: Schema.Literals(["observed", "inferred"]).pipe(
    Schema.withDecodingDefaultKey(Effect.sync(() => "observed" as const)),
  ),
  ruleIds: Schema.optional(Schema.Array(Schema.String)),
  evidence: Schema.optional(Schema.Array(EdgeEvidenceItemSchema)),
  points: Schema.Array(LayoutPointSchema),
});
export type LayoutEdge = DeepMutable<typeof LayoutEdgeSchema.Type>;

const DiagramLaneSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  x: Schema.Finite,
  y: Schema.Finite,
  w: Schema.Finite,
  h: Schema.Finite,
  lateral: Schema.optional(Schema.Boolean),
});
export type DiagramLane = DeepMutable<typeof DiagramLaneSchema.Type>;

const StaticTraceStepSchema = Schema.Struct({
  nodeId: Schema.NonEmptyString,
  edgeId: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String),
  line: Schema.optional(PosInt),
});

const StaticTraceSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  disclaimer: Schema.Literal("Static path — imports & declared wiring, not observed runtime flow."),
  diagramId: Schema.NonEmptyString,
  steps: Schema.Array(StaticTraceStepSchema),
});
export type StaticTrace = DeepMutable<typeof StaticTraceSchema.Type>;

const DiagramLayoutSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  subtitle: Schema.NonEmptyString,
  category: Schema.Literals(["runtime", "modules", "subsystem", "packages", "domains", "layers", "behavior", "delivery"]),
  tierKind: Schema.optional(Schema.Literals(["inferred_dag_tiers", "enforced_layer_policy"])),
  ownerId: Schema.optional(Schema.String),
  parentDiagramId: Schema.optional(Schema.String),
  rankdir: Schema.Literals(["LR", "TB"]),
  width: Schema.Finite,
  height: Schema.Finite,
  lanes: Schema.optional(Schema.Array(DiagramLaneSchema)),
  unconnectedNodes: Schema.optional(
    Schema.Array(Schema.Struct({ id: Schema.String, label: Schema.String, kind: Schema.String })),
  ),
  foldedCount: Schema.optional(NonNegInt),
  nodes: Schema.Array(LayoutNodeSchema),
  edges: Schema.Array(LayoutEdgeSchema),
});
export type DiagramLayout = DeepMutable<typeof DiagramLayoutSchema.Type>;

const CoverageSourceSchema = Schema.Literals(["lcov", "istanbul", "cobertura", "static_reachability_1hop"]);
export type CoverageSource = typeof CoverageSourceSchema.Type;

const VerificationCoverageSchema = Schema.Struct({
  totalSourceFiles: NonNegInt,
  directlyTestedSourceFiles: NonNegInt,
  directTestCoveragePct: PctSchema,
  coverageSource: Schema.optional(CoverageSourceSchema),
  realLineCoveragePct: Schema.optional(Schema.NullOr(PctSchema)),
  realBranchCoveragePct: Schema.optional(Schema.NullOr(PctSchema)),
  coverageReportFile: Schema.optional(Schema.NullOr(Schema.String)),
  registeredGates: NonNegInt,
  ciWiredGates: NonNegInt,
  unwiredGateNames: Schema.Array(Schema.String),
  invariantsPassed: NonNegInt,
  invariantsWarned: NonNegInt,
  invariantsFailed: NonNegInt,
  invariantsNa: NonNegInt,
});
export type VerificationCoverage = DeepMutable<typeof VerificationCoverageSchema.Type>;

const DiagnosticSchema = Schema.Struct({
  code: Schema.NonEmptyString,
  severity: Schema.Literals(["error", "warn", "info"]),
  message: Schema.NonEmptyString,
});
export type SpecDiagnostic = DeepMutable<typeof DiagnosticSchema.Type>;

const CatalogArtifactSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  kind: Schema.Literals(["openapi", "formal_spec", "schema", "governance_doc"]),
  file: Schema.NonEmptyString,
  ownerUnitId: Schema.NullOr(Schema.String),
});
export type CatalogArtifact = DeepMutable<typeof CatalogArtifactSchema.Type>;

const SpecSummarySchema = Schema.Struct({
  totalNodes: NonNegInt,
  totalEdges: NonNegInt,
  totalRules: NonNegInt,
  crossDomainEdges: NonNegInt,
  countsByDomain: Schema.Record(DomainSchema, NonNegInt),
  countsByNodeKind: Schema.Record(Schema.String, NonNegInt),
  countsByEdgeKind: Schema.Record(Schema.String, NonNegInt),
  testFilesByRung: Schema.Record(Schema.String, NonNegInt),
  iacByPlane: Schema.Record(IacPlaneSchema, NonNegInt),
  workflowCount: NonNegInt,
  ciJobCount: NonNegInt,
  indexedSourceFiles: NonNegInt,
  indexedImportEdges: NonNegInt,
  datastoreEntities: NonNegInt,
  externalServices: NonNegInt,
  stateMachines: NonNegInt,
  loops: NonNegInt,
  httpEndpoints: NonNegInt,
  foreignKeys: NonNegInt,
  envBindings: NonNegInt,
  govRules: NonNegInt,
  docDriftCount: NonNegInt,
});
export type SpecSummary = DeepMutable<typeof SpecSummarySchema.Type>;

const HttpEndpointSummarySchema = Schema.Struct({
  unit: Schema.NonEmptyString,
  method: Schema.NonEmptyString,
  path: Schema.NonEmptyString,
  authGuard: Schema.NullOr(Schema.String),
  source: Schema.Literals(["openapi", "ast"]),
  resolution: Schema.optional(Schema.Literals(["contract", "mounted", "fragment"])),
  file: Schema.NonEmptyString,
  line: Schema.optional(PosInt),
});
export type HttpEndpointSummary = DeepMutable<typeof HttpEndpointSummarySchema.Type>;

const ForeignKeySummarySchema = Schema.Struct({
  fromTable: Schema.NonEmptyString,
  fromColumn: Schema.NonEmptyString,
  toTable: Schema.NonEmptyString,
  toColumn: Schema.NonEmptyString,
  onDelete: Schema.NullOr(Schema.String),
  file: Schema.NonEmptyString,
});
export type ForeignKeySummary = DeepMutable<typeof ForeignKeySummarySchema.Type>;

const EnvBindingSummarySchema = Schema.Struct({
  name: Schema.NonEmptyString,
  sources: Schema.Array(Schema.String),
  units: Schema.Array(Schema.String),
  isSecret: Schema.Boolean,
  sampleFile: Schema.NonEmptyString,
});
export type EnvBindingSummary = DeepMutable<typeof EnvBindingSummarySchema.Type>;

const GovRuleSummarySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  kind: Schema.Literals(["instruction", "prohibition", "owner", "diagnostic", "lint_ratchet"]),
  scopePrefix: Schema.String,
  symbol: Schema.NullOr(Schema.String),
  text: Schema.NonEmptyString,
  rationale: Schema.NullOr(Schema.String),
  file: Schema.NonEmptyString,
  line: Schema.optional(PosInt),
});
export type GovRuleSummary = DeepMutable<typeof GovRuleSummarySchema.Type>;

export const FactRecordSchema = Schema.Struct({
  extractorId: Schema.NonEmptyString,
  kind: Schema.NonEmptyString,
  key: Schema.NonEmptyString,
  file: Schema.NonEmptyString,
  line: NonNegInt,
  unit: Schema.String,
  symbol: Schema.optional(Schema.String),
  severity: Schema.optional(Schema.Literals(["info", "warn", "error"])),
  payload: Schema.Record(Schema.String, Schema.Unknown),
});

const FactEdgeRecordSchema = Schema.Struct({
  extractorId: Schema.NonEmptyString,
  kind: Schema.NonEmptyString,
  fromRef: Schema.NonEmptyString,
  toRef: Schema.NonEmptyString,
  file: Schema.NonEmptyString,
  line: NonNegInt,
  payload: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

const MetricRecordSchema = Schema.Struct({
  extractorId: Schema.NonEmptyString,
  scopeKind: Schema.Literals(["repo", "unit", "module", "file"]),
  scopeId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  valueNum: Schema.optional(Schema.Finite),
  valueText: Schema.optional(Schema.String),
});

const SoundinessEntrySchema = Schema.Struct({
  category: Schema.NonEmptyString,
  file: Schema.NonEmptyString,
  line: NonNegInt,
  detail: Schema.NonEmptyString,
});

const SoundinessLedgerSchema = Schema.Struct({
  totalApproximations: NonNegInt,
  byCategory: Schema.Record(Schema.String, NonNegInt),
  entries: Schema.Array(SoundinessEntrySchema),
});
export type SoundinessLedger = DeepMutable<typeof SoundinessLedgerSchema.Type>;

const SpecExtensionsSchema = Schema.Struct({
  facts: Schema.Array(FactRecordSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.sync(() => [] as readonly (typeof FactRecordSchema.Encoded)[])),
  ),
  factEdges: Schema.Array(FactEdgeRecordSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.sync(() => [] as readonly (typeof FactEdgeRecordSchema.Encoded)[])),
  ),
  metrics: Schema.Array(MetricRecordSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.sync(() => [] as readonly (typeof MetricRecordSchema.Encoded)[])),
  ),
});

export const RepoSpecV4Schema = Schema.Struct({
  schemaVersion: Schema.Literal("5.0.0"),
  specKind: Schema.Literal("repospec.canonical"),
  repo: Schema.Struct({
    name: Schema.NonEmptyString,
    ecosystem: EcosystemSchema,
    languages: Schema.Array(Schema.String),
    commitSha: Schema.NullOr(Schema.String),
    branch: Schema.NullOr(Schema.String),
    remote: Schema.NullOr(Schema.String),
    scopeRootRel: Schema.NonEmptyString,
    storageMode: StorageModeSchema,
    extractors: Schema.Array(Schema.String),
  }),
  nodes: Schema.Array(SpecNodeSchema),
  edges: Schema.Array(SpecEdgeSchema),
  rules: Schema.Array(SpecRuleSchema),
  invariants: Schema.Array(SqlInvariantResultSchema),
  entities: Schema.Array(EntityOwnershipSchema),
  stateMachines: Schema.Array(StateMachineRecordSchema),
  loops: Schema.Array(LoopRecordSchema),
  catalogArtifacts: Schema.Array(CatalogArtifactSchema),
  modules: Schema.Array(ModuleCardSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.sync(() => [] as readonly (typeof ModuleCardSchema.Encoded)[])),
  ),
  traces: Schema.Array(StaticTraceSchema),
  surfaces: Schema.Struct({
    endpoints: Schema.Array(HttpEndpointSummarySchema),
    foreignKeys: Schema.Array(ForeignKeySummarySchema),
    envBindings: Schema.Array(EnvBindingSummarySchema),
    govRules: Schema.Array(GovRuleSummarySchema),
  }),
  diagrams: Schema.Array(DiagramLayoutSchema),
  verification: VerificationCoverageSchema,
  soundiness: Schema.optional(SoundinessLedgerSchema),
  diagnostics: Schema.Array(DiagnosticSchema),
  summary: SpecSummarySchema,
  extensions: SpecExtensionsSchema.pipe(
    Schema.withDecodingDefaultKey(
      Effect.sync(() => ({
        facts: [] as readonly (typeof FactRecordSchema.Encoded)[],
        factEdges: [] as readonly (typeof FactEdgeRecordSchema.Encoded)[],
        metrics: [] as readonly (typeof MetricRecordSchema.Encoded)[],
      })),
    ),
  ),
});
export type RepoSpecV4 = DeepMutable<typeof RepoSpecV4Schema.Type>;

export function parseRepoSpec(input: unknown): RepoSpecV4 {
  return Schema.decodeUnknownSync(RepoSpecV4Schema)(input) as RepoSpecV4;
}

export function decodeRepoSpecEffect(input: unknown): Effect.Effect<RepoSpecV4, SchemaValidationError> {
  return Effect.try({
    try: () => parseRepoSpec(input),
    catch: (cause) =>
      new SchemaValidationError({
        subject: "RepoSpecV4",
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });
}

export function buildRepoSpecJsonSchema(): Record<string, unknown> {
  const doc = Schema.toJsonSchemaDocument(RepoSpecV4Schema);
  const out: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://repospec.dev/schemas/repospec.v5.schema.json",
    title: "RepoSpec Canonical IR v5.0.0",
    ...(doc.schema as Record<string, unknown>),
  };
  if (Object.keys(doc.definitions).length > 0) {
    out.$defs = doc.definitions;
  }
  return out;
}
