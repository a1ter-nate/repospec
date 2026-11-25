import type {
  CanonicalLayer,
  CapabilityTag,
  Domain,
  Ecosystem,
  ExportedSymbol,
  LayerPolicy,
  LoopRecord,
  SpecEdge,
  SpecNode,
  SpecRule,
  StateMachineRecord,
  StorageMode,
  UnitArchetype,
} from "./primitives.ts";
import type { CatalogArtifact, SpecDiagnostic } from "./specSchema.ts";

export interface UnitDescriptor {
  id: string;
  name: string;
  slug: string;
  dir: string;
  absDir: string;
  manifestFile: string;
  ecosystem: "typescript" | "javascript" | "rust" | "python" | "csharp" | "native";
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
  exportedSymbols?: ExportedSymbol[];
  capabilities?: CapabilityTag[];
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
