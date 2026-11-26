export {
  buildDeclarativeFactsExtractor,
  loadDeclarativeFactsExtractor,
} from "./internal/declarativeFacts.ts";
export { diffFactSets, loadRepoExtensions, queryFactsFromDb } from "./internal/loader.ts";
export type {
  DeclarativeFactSpec,
  DeclarativeFactsFile,
} from "./internal/declarativeFacts.ts";
export type { FactDiffResult, LoadedRepoExtensions } from "./internal/loader.ts";
