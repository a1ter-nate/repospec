import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAndPopulateIndexDb, queryFactsFromDb } from "@repospec/core";
import { createEmptyAst } from "@repospec/plugin";

describe("R4 Real-Engine SQLite Migration & Schema Upgrade Slice", () => {
  let tmpDir = "";
  let dbPath = "";

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-r4-migrate-"));
    dbPath = path.join(tmpDir, "legacy.sqlite");
    const legacy = new Database(dbPath);
    legacy.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);");
    legacy.exec("INSERT INTO meta (key, value) VALUES ('schema_version', '4.0.0');");
    legacy.close();
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("cleanly migrates seeded legacy SQLite database to current v5 DDL without orphan corruption", () => {
    const db = createAndPopulateIndexDb({
      dbPath,
      repoName: "migrated-repo",
      commitSha: "01234567",
      scopeRootRel: ".",
      units: [],
      nodes: [],
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
          extractorId: "migration.check",
          kind: "migrated_fact",
          key: "v5-ready",
          file: "src/app.ts",
          line: 1,
          unit: "migrated-repo",
          payload: {},
        },
      ],
    });
    db.close();

    const fresh = new Database(dbPath, { readonly: true });
    try {
      const tables = fresh
        .query("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const names = new Set(tables.map((t) => t.name));
      expect(names.has("nodes")).toBe(true);
      expect(names.has("edges")).toBe(true);
      expect(names.has("facts")).toBe(true);
      const rows = queryFactsFromDb(fresh, { kind: "migrated_fact" });
      expect(rows.length).toBe(1);
    } finally {
      fresh.close();
    }
  });
});
