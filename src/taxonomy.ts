export {
  classifyExternalPackage,
  classifyVendorPackage,
  resolveCanonicalLayer,
  resolveLayerSemantics,
  vendorLabelForPackage,
  type ExternalPackageClassification,
  type LayerSemantics,
} from "./internal/taxonomy/layers.ts";
export {
  canonicalizeGitRemote,
  CONTAINER_DIRS,
  inferNodeRole,
  isNonDomainBucket,
  resolveFeatureOrLayerPath,
  singularize,
} from "./internal/taxonomy/paths.ts";
export { workspaceNodeId, workspaceSlug } from "./internal/taxonomy/unitHelpers.ts";
export { discoverUnits, resolveUnitForFile } from "./internal/taxonomy/units.ts";
