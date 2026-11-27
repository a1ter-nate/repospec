import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startStudioServer } from "@repospec/plugin-studio";

describe("R4 Studio Loopback HTTP Server Integration Slice", () => {
  let tmpDir = "";
  let htmlPath = "";

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-r4-http-"));
    htmlPath = path.join(tmpDir, "repospec.html");
    fs.writeFileSync(htmlPath, "<!doctype html><html><body><h1>Studio R4</h1></body></html>", "utf8");
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("serves rendered HTML over real loopback HTTP and blocks non-loopback proxy SSRF", async () => {
    const handle = startStudioServer({ targetPath: htmlPath, port: 0 });
    try {
      const res = await fetch(handle.url);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Studio R4");

      const ssrf = await fetch(`${handle.url}/api/ollama`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "llama3", prompt: "hi", target: "http://169.254.169.254/" }),
      });
      expect(ssrf.status).toBeGreaterThanOrEqual(400);
    } finally {
      handle.stop();
    }
  });
});
