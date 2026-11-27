import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPluginHost } from "@repospec/core";
import { startStudioServer } from "@repospec/plugin-studio";

const REPOSPEC_ROOT = path.resolve(import.meta.dir, "../../../..");
const SAMPLE_APP = path.join(REPOSPEC_ROOT, "tests/fixtures/sample-app");

describe("R7 Studio Golden-Path E2E", () => {
  let tmpDir = "";

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-studio-e2e-"));
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("scans real repo, renders Studio HTML, and serves fresh-read bundle over loopback HTTP", async () => {
    const host = await createPluginHost({ repoDir: SAMPLE_APP, includeBuiltins: true });
    const htmlPath = path.join(tmpDir, "repospec.html");
    try {
      const scanRes = await host.scan(SAMPLE_APP, { dbPath: path.join(tmpDir, "e2e.sqlite") });
      fs.writeFileSync(htmlPath, host.renderStudio(scanRes), "utf8");
    } finally {
      await host.dispose();
    }

    const server = startStudioServer({ targetPath: htmlPath, port: 0 });
    try {
      const res = await fetch(server.url);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("repospec-data");
      expect(html).toContain("Entity Journeys");
    } finally {
      server.stop();
    }
  });
});
