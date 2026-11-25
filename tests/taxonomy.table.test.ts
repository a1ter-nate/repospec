import { describe, expect, test } from "bun:test";
import oracle from "./fixtures/taxonomy-oracle.json";
import type { CanonicalLayer } from "../src/schema.ts";
import {
  canonicalizeGitRemote,
  classifyExternalPackage,
  resolveFeatureOrLayerPath,
  resolveLayerSemantics,
} from "../src/taxonomy.ts";

describe("Taxonomy oracle tables (R2 Tests-as-Data) [REQ-TAXONOMY-01]", () => {
  test.each(oracle.layerSemantics)(
    "resolveLayerSemantics($rawLayer, $canonical) -> $axis rank $rank ($laneId)",
    (row) => {
      const actual = resolveLayerSemantics(row.rawLayer, row.canonical as CanonicalLayer);
      expect<string>(actual.axis).toBe(row.axis);
      expect(actual.rank).toBe(row.rank);
      expect(actual.laneId).toBe(row.laneId);
    },
  );

  test.each(oracle.externalPackages)(
    "classifyExternalPackage($pkg) -> $expectedKind ($expectedLabel)",
    (row) => {
      const actual = classifyExternalPackage(row.pkg);
      expect<string | null>(actual?.kind ?? null).toBe(row.expectedKind);
      expect(actual?.category ?? null).toBe(row.expectedCategory);
      expect(actual?.label ?? null).toBe(row.expectedLabel);
    },
  );

  test.each(oracle.gitRemotes)(
    "canonicalizeGitRemote($raw) -> $expected",
    (row) => {
      expect(canonicalizeGitRemote(row.raw)).toBe(row.expected);
    },
  );

  test.each(oracle.featurePaths)(
    "resolveFeatureOrLayerPath($relFile) -> $rawLayer ($canonicalLayer)",
    (row) => {
      const actual = resolveFeatureOrLayerPath(row.relFile, row.unitDir);
      expect(actual.rawLayer).toBe(row.rawLayer);
      expect<string>(actual.canonicalLayer).toBe(row.canonicalLayer);
      expect(actual.inferredDomain).toBe(row.inferredDomain);
    },
  );
});
