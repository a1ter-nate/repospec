export { createAndPopulateIndexDb, storeDigestInDb } from "./internal/indexDb/populate.ts";
export { projectInvariantsToGraph, runSqlInvariants } from "./internal/indexDb/invariants.ts";
export {
  NAMED_QUERIES,
  queryEntityOwnership,
  querySurfaces,
  queryVerificationCoverage,
} from "./internal/indexDb/queries.ts";
