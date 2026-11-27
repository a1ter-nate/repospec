export {
  classifyExternalPackage,
  classifyVendorPackage,
  resolveCanonicalLayer,
  resolveLayerSemantics,
  vendorLabelForPackage,
  type ExternalPackageClassification,
  type LayerSemantics,
} from "./taxonomy/layers.ts";
export {
  canonicalizeGitRemote,
  CONTAINER_DIRS,
  inferNodeRole,
  isNonDomainBucket,
  resolveFeatureOrLayerPath,
  singularize,
} from "./taxonomy/paths.ts";
export { workspaceNodeId, workspaceSlug } from "./taxonomy/unitHelpers.ts";
export { discoverUnits, resolveUnitForFile } from "./taxonomy/units.ts";
