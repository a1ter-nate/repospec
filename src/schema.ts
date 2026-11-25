import { z } from "zod";

export const DomainSchema = z.enum(["arch", "ci", "test", "iac", "rules"]);
export type Domain = z.infer<typeof DomainSchema>;

export const EcosystemSchema = z.enum(["typescript", "rust", "csharp", "polyglot"]);
export type Ecosystem = z.infer<typeof EcosystemSchema>;

export const StorageModeSchema = z.enum(["artifact", "commit"]);
export type StorageMode = z.infer<typeof StorageModeSchema>;

export const IacPlaneSchema = z.enum([
  "network",
  "compute",
  "data",
  "security",
  "observability",
  "ci_infra",
]);
export type IacPlane = z.infer<typeof IacPlaneSchema>;

export const RungSchema = z.enum(["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"]);
export type Rung = z.infer<typeof RungSchema>;

export const CanonicalLayerSchema = z.enum([
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

export const LayerAxisSchema = z.enum(["pipeline", "integration", "foundation"]);
export type LayerAxis = z.infer<typeof LayerAxisSchema>;

export const UnitArchetypeSchema = z.enum([
  "http_service",
  "frontend_app",
  "library_crate",
  "cli_worker",
  "analyzer_plugin",
  "test_suite",
]);
export type UnitArchetype = z.infer<typeof UnitArchetypeSchema>;

export const LayerPolicySchema = z.enum([
  "layered_backend",
  "layered_frontend",
  "layered_clean_arch",
  "flat_library",
]);
export type LayerPolicy = z.infer<typeof LayerPolicySchema>;

export const NodeRoleSchema = z.enum([
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
]);
export type NodeRole = z.infer<typeof NodeRoleSchema>;

export const ProvenanceSchema = z.object({
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

export const EdgeEvidenceItemSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  detail: z.string().min(1),
});
export type EdgeEvidenceItem = z.infer<typeof EdgeEvidenceItemSchema>;

export const NodeFindingSummarySchema = z.object({
  ruleId: z.string().min(1),
  severity: z.enum(["error", "warn", "info"]),
  count: z.number().int().positive(),
});
export type NodeFindingSummary = z.infer<typeof NodeFindingSummarySchema>;

export const SpecNodeSchema = z.object({
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
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
    )
    .default({}),
});
export type SpecNode = z.infer<typeof SpecNodeSchema>;

export const SpecEdgeSchema = z.object({
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

export const RuleEnforcementSchema = z.enum(["static", "executed", "ci_gate", "ownership", "sql_invariant"]);
export type RuleEnforcement = z.infer<typeof RuleEnforcementSchema>;

export const SpecRuleSchema = z.object({
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

export const EvidenceAnchorSchema = z.object({
  diagramId: z.string().min(1),
  nodeIds: z.array(z.string()),
  edgeIds: z.array(z.string()),
});
export type EvidenceAnchor = z.infer<typeof EvidenceAnchorSchema>;

export const InvariantEvidenceSchema = z.object({
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

export const SqlInvariantResultSchema = z.object({
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

export const EntityOwnershipSchema = z.object({
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

export const StateMachineTransitionSchema = z.object({
  from: z.string().min(1),
  event: z.string().min(1),
  to: z.string().min(1),
  guard: z.string().optional(),
});

export const StateMachineRecordSchema = z.object({
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

export const LoopRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["cron", "scheduler", "interval", "background_service", "webhook", "queue_consumer"]),
  schedule: z.string().nullable(),
  unit: z.string().min(1),
  provenance: ProvenanceSchema,
});
export type LoopRecord = z.infer<typeof LoopRecordSchema>;

export const LayoutPointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const LayoutNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  sublabel: z.string().optional(),
  group: z.string().optional(),
  lane: z.string().optional(),
  layerAxis: LayerAxisSchema.optional(),
  layerRank: z.number().int().nonnegative().optional(),
  kind: z.string().min(1),
  role: NodeRoleSchema.optional(),
  domain: DomainSchema,
  shape: z.enum(["box", "pill", "db", "hex"]),
  expandable: z.boolean().optional(),
  ambientBadges: z.array(z.string()).optional(),
  findings: z.array(NodeFindingSummarySchema).optional(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  provenance: ProvenanceSchema.optional(),
});
export type LayoutNode = z.infer<typeof LayoutNodeSchema>;

export const LayoutEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.string().min(1),
  tier: z.enum(["spine", "violation", "detail"]).optional(),
  label: z.string().optional(),
  weight: z.number().int().positive().optional(),
  violation: z.boolean().optional(),
  bidirectional: z.boolean().optional(),
  confidence: z.enum(["observed", "inferred"]).default("observed"),
  ruleIds: z.array(z.string()).optional(),
  evidence: z.array(EdgeEvidenceItemSchema).optional(),
  points: z.array(LayoutPointSchema),
});
export type LayoutEdge = z.infer<typeof LayoutEdgeSchema>;

export const DiagramLaneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  lateral: z.boolean().optional(),
});
export type DiagramLane = z.infer<typeof DiagramLaneSchema>;

export const StaticTraceStepSchema = z.object({
  nodeId: z.string().min(1),
  edgeId: z.string().optional(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
});

export const StaticTraceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  disclaimer: z.literal("Static path — imports & declared wiring, not observed runtime flow."),
  diagramId: z.string().min(1),
  steps: z.array(StaticTraceStepSchema),
});
export type StaticTrace = z.infer<typeof StaticTraceSchema>;

export const DiagramLayoutSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  category: z.enum(["runtime", "packages", "domains", "layers", "behavior", "delivery"]),
  ownerId: z.string().optional(),
  rankdir: z.enum(["LR", "TB"]),
  width: z.number(),
  height: z.number(),
  lanes: z.array(DiagramLaneSchema).optional(),
  unconnectedNodes: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string() })).optional(),
  foldedCount: z.number().int().nonnegative().optional(),
  nodes: z.array(LayoutNodeSchema),
  edges: z.array(LayoutEdgeSchema),
});
export type DiagramLayout = z.infer<typeof DiagramLayoutSchema>;

export const VerificationCoverageSchema = z.object({
  totalSourceFiles: z.number().int().nonnegative(),
  directlyTestedSourceFiles: z.number().int().nonnegative(),
  directTestCoveragePct: z.number().min(0).max(100),
  registeredGates: z.number().int().nonnegative(),
  ciWiredGates: z.number().int().nonnegative(),
  unwiredGateNames: z.array(z.string()),
  invariantsPassed: z.number().int().nonnegative(),
  invariantsWarned: z.number().int().nonnegative(),
  invariantsFailed: z.number().int().nonnegative(),
  invariantsNa: z.number().int().nonnegative(),
});
export type VerificationCoverage = z.infer<typeof VerificationCoverageSchema>;

export const DiagnosticSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["error", "warn", "info"]),
  message: z.string().min(1),
});
export type SpecDiagnostic = z.infer<typeof DiagnosticSchema>;

export const CatalogArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["openapi", "formal_spec", "schema", "governance_doc"]),
  file: z.string().min(1),
  ownerUnitId: z.string().nullable(),
});
export type CatalogArtifact = z.infer<typeof CatalogArtifactSchema>;

export const SpecSummarySchema = z.object({
  totalNodes: z.number().int().nonnegative(),
  totalEdges: z.number().int().nonnegative(),
  totalRules: z.number().int().nonnegative(),
  crossDomainEdges: z.number().int().nonnegative(),
  countsByDomain: z.record(DomainSchema, z.number().int().nonnegative()),
  countsByNodeKind: z.record(z.string(), z.number().int().nonnegative()),
  countsByEdgeKind: z.record(z.string(), z.number().int().nonnegative()),
  testFilesByRung: z.record(z.string(), z.number().int().nonnegative()),
  iacByPlane: z.record(IacPlaneSchema, z.number().int().nonnegative()),
  workflowCount: z.number().int().nonnegative(),
  ciJobCount: z.number().int().nonnegative(),
  indexedSourceFiles: z.number().int().nonnegative(),
  indexedImportEdges: z.number().int().nonnegative(),
  datastoreEntities: z.number().int().nonnegative(),
  externalServices: z.number().int().nonnegative(),
  stateMachines: z.number().int().nonnegative(),
  loops: z.number().int().nonnegative(),
  httpEndpoints: z.number().int().nonnegative(),
  foreignKeys: z.number().int().nonnegative(),
  envBindings: z.number().int().nonnegative(),
  govRules: z.number().int().nonnegative(),
  docDriftCount: z.number().int().nonnegative(),
});
export type SpecSummary = z.infer<typeof SpecSummarySchema>;

export const HttpEndpointSummarySchema = z.object({
  unit: z.string().min(1),
  method: z.string().min(1),
  path: z.string().min(1),
  authGuard: z.string().nullable(),
  source: z.enum(["openapi", "ast"]),
  resolution: z.enum(["contract", "mounted", "fragment"]).optional(),
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
});
export type HttpEndpointSummary = z.infer<typeof HttpEndpointSummarySchema>;

export const ForeignKeySummarySchema = z.object({
  fromTable: z.string().min(1),
  fromColumn: z.string().min(1),
  toTable: z.string().min(1),
  toColumn: z.string().min(1),
  onDelete: z.string().nullable(),
  file: z.string().min(1),
});
export type ForeignKeySummary = z.infer<typeof ForeignKeySummarySchema>;

export const EnvBindingSummarySchema = z.object({
  name: z.string().min(1),
  sources: z.array(z.string()),
  units: z.array(z.string()),
  isSecret: z.boolean(),
  sampleFile: z.string().min(1),
});
export type EnvBindingSummary = z.infer<typeof EnvBindingSummarySchema>;

export const GovRuleSummarySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["instruction", "prohibition", "owner", "diagnostic", "lint_ratchet"]),
  scopePrefix: z.string(),
  symbol: z.string().nullable(),
  text: z.string().min(1),
  rationale: z.string().nullable(),
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
});
export type GovRuleSummary = z.infer<typeof GovRuleSummarySchema>;

export const RepoSpecV4Schema = z.object({
  schemaVersion: z.literal("4.1.0"),
  specKind: z.literal("repospec.canonical"),
  repo: z.object({
    name: z.string().min(1),
    ecosystem: EcosystemSchema,
    languages: z.array(z.string()),
    commitSha: z.string().nullable(),
    branch: z.string().nullable(),
    remote: z.string().nullable(),
    scopeRootRel: z.string().min(1),
    storageMode: StorageModeSchema,
    extractors: z.array(z.string()),
  }),
  nodes: z.array(SpecNodeSchema),
  edges: z.array(SpecEdgeSchema),
  rules: z.array(SpecRuleSchema),
  invariants: z.array(SqlInvariantResultSchema),
  entities: z.array(EntityOwnershipSchema),
  stateMachines: z.array(StateMachineRecordSchema),
  loops: z.array(LoopRecordSchema),
  catalogArtifacts: z.array(CatalogArtifactSchema),
  traces: z.array(StaticTraceSchema),
  surfaces: z.object({
    endpoints: z.array(HttpEndpointSummarySchema),
    foreignKeys: z.array(ForeignKeySummarySchema),
    envBindings: z.array(EnvBindingSummarySchema),
    govRules: z.array(GovRuleSummarySchema),
  }),
  diagrams: z.array(DiagramLayoutSchema),
  verification: VerificationCoverageSchema,
  diagnostics: z.array(DiagnosticSchema),
  summary: SpecSummarySchema,
});
export type RepoSpecV4 = z.infer<typeof RepoSpecV4Schema>;

export interface UnitDescriptor {
  id: string;
  name: string;
  slug: string;
  dir: string;
  absDir: string;
  manifestFile: string;
  ecosystem: "typescript" | "rust" | "csharp" | "native";
  kind: "app" | "package" | "test_package" | "native_app" | "analyzer";
  archetype: UnitArchetype;
  layerPolicy: LayerPolicy;
  external: boolean;
  entryFile: string | null;
  targetFramework: string | null;
  bins: string[];
}

export interface AstFileFact {
  file: string;
  unit: string;
  language: string;
  layer: string;
  canonicalLayer: CanonicalLayer;
  domainArea: string | null;
  layerSource: "declared_manifest" | "path_convention" | "token_heuristic";
  domainSource: "declared_manifest" | "subdir_module" | "path_convention" | "none";
  isTest: boolean;
  isBarrel: boolean;
  lines: number;
  exportsCount: number;
}

export interface AstImportFact {
  fromFile: string;
  toFile: string;
  fromUnit: string;
  toUnit: string;
  fromLayer: string;
  toLayer: string;
  fromCanonicalLayer: CanonicalLayer;
  toCanonicalLayer: CanonicalLayer;
  fromDomain: string | null;
  toDomain: string | null;
  line: number;
  typeOnly: boolean;
}

export interface AstPkgImportFact {
  fromFile: string;
  unit: string;
  layer: string;
  canonicalLayer: CanonicalLayer;
  pkg: string;
  vendorCategory: string | null;
  line: number;
  typeOnly: boolean;
}

export interface AstDeclaredEntityFact {
  datastore: string;
  entity: string;
  declaredAt: string;
  authorizedShared: boolean;
  hasTenancyKey?: boolean;
}

export interface AstEntityAccessFact {
  datastore: string;
  entity: string;
  file: string;
  unit: string;
  layer: string;
  canonicalLayer: CanonicalLayer;
  domainArea: string | null;
  op: string;
  line: number;
  confidence: "observed" | "inferred";
}

export interface AstExternalHostFact {
  file: string;
  unit: string;
  layer: string;
  canonicalLayer: CanonicalLayer;
  host: string;
  serviceLabel: string;
  category: string;
  line: number;
}

export interface AstStateEnumFact {
  file: string;
  unit: string;
  language: string;
  name: string;
  valuesSignature: string;
  values: string[];
  line: number;
  hasTransitions: boolean;
}

export interface HttpEndpointFact {
  unit: string;
  method: string;
  path: string;
  authGuard: string | null;
  source: "openapi" | "ast";
  resolution?: "contract" | "mounted" | "fragment";
  handlerFile: string;
  line: number;
  operationId: string | null;
}

export interface DbForeignKeyFact {
  datastore: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  onDelete: string | null;
  declaredAt: string;
  line: number;
}

export interface EnvBindingFact {
  envName: string;
  sourceKind: "code_read" | "env_example" | "iac_env" | "iac_secret" | "ci_config";
  unit: string;
  file: string;
  line: number;
  isSecret: boolean;
}

export interface GovRuleFact {
  id: string;
  kind: "instruction" | "prohibition" | "owner" | "diagnostic" | "lint_ratchet";
  scopePrefix: string;
  symbol: string | null;
  text: string;
  rationale: string | null;
  file: string;
  line: number;
}

export interface DocPathRefFact {
  docFile: string;
  line: number;
  referencedPath: string;
  existsInRepo: boolean;
}

export interface AstIndexData {
  files: AstFileFact[];
  fileImports: AstImportFact[];
  pkgImports: AstPkgImportFact[];
  declaredEntities: AstDeclaredEntityFact[];
  entityAccesses: AstEntityAccessFact[];
  externalHosts: AstExternalHostFact[];
  stateEnums: AstStateEnumFact[];
  httpEndpoints: HttpEndpointFact[];
  dbForeignKeys: DbForeignKeyFact[];
  envBindings: EnvBindingFact[];
  govRules: GovRuleFact[];
  docPathRefs: DocPathRefFact[];
}

export interface GraphFragment {
  nodes: SpecNode[];
  edges: SpecEdge[];
  rules: SpecRule[];
  stateMachines?: StateMachineRecord[];
  loops?: LoopRecord[];
  catalogArtifacts?: CatalogArtifact[];
  diagnostics?: SpecDiagnostic[];
  ast?: AstIndexData;
}

export interface RepoContext {
  rootDir: string;
  scopeRoot: string;
  scopeRootRel: string;
  repoName: string;
  ecosystem: Ecosystem;
  languages: string[];
  commitSha: string | null;
  branch: string | null;
  remote: string | null;
  storageMode: StorageMode;
  allFiles: string[];
  units: UnitDescriptor[];
}

export interface ExtractorPlugin {
  id: string;
  domain: Domain;
  extract(ctx: RepoContext): Promise<GraphFragment>;
}

export function createEmptyAst(): AstIndexData {
  return {
    files: [],
    fileImports: [],
    pkgImports: [],
    declaredEntities: [],
    entityAccesses: [],
    externalHosts: [],
    stateEnums: [],
    httpEndpoints: [],
    dbForeignKeys: [],
    envBindings: [],
    govRules: [],
    docPathRefs: [],
  };
}

export function buildRepoSpecJsonSchema(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://repospec.dev/schemas/repospec.v4.schema.json",
    title: "RepoSpec Canonical IR v4.1.0",
    type: "object",
    required: [
      "schemaVersion",
      "specKind",
      "repo",
      "nodes",
      "edges",
      "rules",
      "invariants",
      "entities",
      "stateMachines",
      "loops",
      "catalogArtifacts",
      "traces",
      "surfaces",
      "diagrams",
      "verification",
      "diagnostics",
      "summary",
    ],
    additionalProperties: false,
    properties: {
      schemaVersion: { const: "4.1.0" },
      specKind: { const: "repospec.canonical" },
      repo: {
        type: "object",
        required: [
          "name",
          "ecosystem",
          "languages",
          "commitSha",
          "branch",
          "remote",
          "scopeRootRel",
          "storageMode",
          "extractors",
        ],
        properties: {
          name: { type: "string", minLength: 1 },
          ecosystem: { enum: [...EcosystemSchema.options] },
          languages: { type: "array", items: { type: "string" } },
          commitSha: { type: ["string", "null"] },
          branch: { type: ["string", "null"] },
          remote: { type: ["string", "null"] },
          scopeRootRel: { type: "string", minLength: 1 },
          storageMode: { enum: [...StorageModeSchema.options] },
          extractors: { type: "array", items: { type: "string" } },
        },
      },
      nodes: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "domain", "kind", "label", "provenance", "tags", "meta"],
          properties: {
            id: { type: "string" },
            domain: { enum: [...DomainSchema.options] },
            kind: { enum: [...NodeKindSchema.options] },
            role: { enum: [...NodeRoleSchema.options] },
            label: { type: "string" },
            group: { type: "string" },
            ownerId: { type: "string" },
            provenance: {
              type: "object",
              required: ["file"],
              properties: { file: { type: "string" }, line: { type: "integer", minimum: 1 } },
            },
            tags: { type: "array", items: { type: "string" } },
            findings: { type: "array" },
            meta: { type: "object" },
          },
        },
      },
      edges: {
        type: "array",
        items: {
          type: "object",
          required: ["from", "to", "kind", "confidence"],
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            kind: { enum: [...EdgeKindSchema.options] },
            label: { type: "string" },
            weight: { type: "integer", minimum: 1 },
            violation: { type: "boolean" },
            ruleIds: { type: "array", items: { type: "string" } },
            confidence: { enum: ["observed", "inferred"] },
          },
        },
      },
      rules: { type: "array", items: { type: "object" } },
      invariants: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "name", "rung", "severity", "status", "sqlFile", "statement", "why", "fix", "violationCount", "evidence"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            rung: { enum: [...RungSchema.options] },
            severity: { enum: ["error", "warn", "info"] },
            status: { enum: ["pass", "warn", "fail", "na"] },
            applicabilityReason: { type: "string" },
            violationCount: { type: "integer", minimum: 0 },
          },
        },
      },
      entities: { type: "array", items: { type: "object" } },
      stateMachines: { type: "array", items: { type: "object" } },
      loops: { type: "array", items: { type: "object" } },
      catalogArtifacts: { type: "array", items: { type: "object" } },
      traces: { type: "array", items: { type: "object" } },
      surfaces: {
        type: "object",
        required: ["endpoints", "foreignKeys", "envBindings", "govRules"],
        properties: {
          endpoints: { type: "array" },
          foreignKeys: { type: "array" },
          envBindings: { type: "array" },
          govRules: { type: "array" },
        },
      },
      diagrams: { type: "array", items: { type: "object" } },
      verification: { type: "object" },
      diagnostics: { type: "array", items: { type: "object" } },
      summary: { type: "object" },
    },
  };
}
