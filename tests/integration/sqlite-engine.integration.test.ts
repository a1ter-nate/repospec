import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAndPopulateIndexDb, queryFactsFromDb, runSqlInvariants, storeDigestInDb } from "@repospec/core";
import { createEmptyAst } from "@repospec/plugin";

const RULES_DIR = path.resolve(import.meta.dir, "../../rules");

describe("R4 Real-Engine SQLite Integration Slice", () => {
  let tmpDir = "";
  let dbPath = "";

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-r4-sqlite-"));
    dbPath = path.join(tmpDir, "index.sqlite");
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates real bun:sqlite tables, populates graph and facts, runs SQL invariants, and persists digest", () => {
    const db = createAndPopulateIndexDb({
      dbPath,
      repoName: "r4-sqlite-fixture",
      commitSha: "deadbeef",
      scopeRootRel: ".",
      units: [
        {
          id: "arch:pkg:core",
          name: "core",
          slug: "core",
          dir: ".",
          absDir: tmpDir,
          manifestFile: "package.json",
          ecosystem: "typescript",
          kind: "package",
          archetype: "library_crate",
          layerPolicy: "flat_library",
          external: false,
          entryFile: null,
          targetFramework: null,
          bins: [],
        },
      ],
      nodes: [
        {
          id: "arch:pkg:core",
          domain: "arch",
          kind: "package",
          role: "service",
          label: "core",
          group: "core",
          provenance: { file: "package.json", line: 1 },
          tags: [],
          meta: {},
        },
      ],
      edges: [],
      rules: [],
      ast: createEmptyAst(),
      stateMachines: [],
      loops: [],
      catalogArtifacts: [],
      modules: [],
      realCoverage: null,
      facts: [
        {
          extractorId: "r4.probe",
          kind: "r4_marker",
          key: "alpha",
          file: "src/index.ts",
          line: 1,
          unit: "core",
          payload: { ok: true },
        },
      ],
    });
    const invariants = runSqlInvariants(db, RULES_DIR, [], []);
    db.close();
    storeDigestInDb(dbPath, "sha256-r4-verified");

    const readonlyDb = new Database(dbPath, { readonly: true });
    try {
      const facts = queryFactsFromDb(readonlyDb, { kind: "r4_marker" });
      expect(facts.length).toBe(1);
      expect(facts[0]?.key).toBe("alpha");
      expect(invariants.length).toBeGreaterThanOrEqual(14);
      const metaRow = readonlyDb.query("SELECT value FROM meta WHERE key = 'specDigest'").get() as { value?: string } | null;
      expect(metaRow?.value).toBe("sha256-r4-verified");
    } finally {
      readonlyDb.close();
    }
  });
});
