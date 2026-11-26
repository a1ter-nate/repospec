import { z } from "zod";
import { DomainSchema, EdgeKindSchema, NodeKindSchema, PRIMITIVE_SCHEMAS } from "./primitives.ts";

const {
  EcosystemSchema,
  ModuleCardSchema,
  StorageModeSchema,
  IacPlaneSchema,
  RungSchema,
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
} = PRIMITIVE_SCHEMAS;

const LayoutPointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const LayoutNodeSchema = z.object({
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

const LayoutEdgeSchema = z.object({
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

const DiagramLaneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  lateral: z.boolean().optional(),
});
export type DiagramLane = z.infer<typeof DiagramLaneSchema>;

const StaticTraceStepSchema = z.object({
  nodeId: z.string().min(1),
  edgeId: z.string().optional(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
});

const StaticTraceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  disclaimer: z.literal("Static path — imports & declared wiring, not observed runtime flow."),
  diagramId: z.string().min(1),
  steps: z.array(StaticTraceStepSchema),
});
export type StaticTrace = z.infer<typeof StaticTraceSchema>;

const DiagramLayoutSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  category: z.enum(["runtime", "modules", "subsystem", "packages", "domains", "layers", "behavior", "delivery"]),
  ownerId: z.string().optional(),
  parentDiagramId: z.string().optional(),
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

const CoverageSourceSchema = z.enum(["lcov", "istanbul", "cobertura", "static_reachability_1hop"]);
export type CoverageSource = z.infer<typeof CoverageSourceSchema>;

const VerificationCoverageSchema = z.object({
  totalSourceFiles: z.number().int().nonnegative(),
  directlyTestedSourceFiles: z.number().int().nonnegative(),
  directTestCoveragePct: z.number().min(0).max(100),
  coverageSource: CoverageSourceSchema.optional(),
  realLineCoveragePct: z.number().min(0).max(100).nullable().optional(),
  realBranchCoveragePct: z.number().min(0).max(100).nullable().optional(),
  coverageReportFile: z.string().nullable().optional(),
  registeredGates: z.number().int().nonnegative(),
  ciWiredGates: z.number().int().nonnegative(),
  unwiredGateNames: z.array(z.string()),
  invariantsPassed: z.number().int().nonnegative(),
  invariantsWarned: z.number().int().nonnegative(),
  invariantsFailed: z.number().int().nonnegative(),
  invariantsNa: z.number().int().nonnegative(),
});
export type VerificationCoverage = z.infer<typeof VerificationCoverageSchema>;

const DiagnosticSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["error", "warn", "info"]),
  message: z.string().min(1),
});
export type SpecDiagnostic = z.infer<typeof DiagnosticSchema>;

const CatalogArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["openapi", "formal_spec", "schema", "governance_doc"]),
  file: z.string().min(1),
  ownerUnitId: z.string().nullable(),
});
export type CatalogArtifact = z.infer<typeof CatalogArtifactSchema>;

const SpecSummarySchema = z.object({
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

const HttpEndpointSummarySchema = z.object({
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

const ForeignKeySummarySchema = z.object({
  fromTable: z.string().min(1),
  fromColumn: z.string().min(1),
  toTable: z.string().min(1),
  toColumn: z.string().min(1),
  onDelete: z.string().nullable(),
  file: z.string().min(1),
});
export type ForeignKeySummary = z.infer<typeof ForeignKeySummarySchema>;

const EnvBindingSummarySchema = z.object({
  name: z.string().min(1),
  sources: z.array(z.string()),
  units: z.array(z.string()),
  isSecret: z.boolean(),
  sampleFile: z.string().min(1),
});
export type EnvBindingSummary = z.infer<typeof EnvBindingSummarySchema>;

const GovRuleSummarySchema = z.object({
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
  schemaVersion: z.literal("5.0.0"),
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
  modules: z.array(ModuleCardSchema).default([]),
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

export function buildRepoSpecJsonSchema(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://repospec.dev/schemas/repospec.v5.schema.json",
    title: "RepoSpec Canonical IR v5.0.0",
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
      "modules",
      "traces",
      "surfaces",
      "diagrams",
      "verification",
      "diagnostics",
      "summary",
    ],
    additionalProperties: false,
    properties: {
      schemaVersion: { const: "5.0.0" },
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
      modules: { type: "array", items: { type: "object" } },
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
