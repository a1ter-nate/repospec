import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPluginHost } from "@repospec/core";
import { startStudioServer } from "@repospec/plugin-studio";

async function runSyntheticProbe(): Promise<void> {
  const root = path.resolve(import.meta.dir, "..");
  const sampleRepo = path.join(root, "tests/fixtures/sample-app");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-synthetic-"));
  const htmlPath = path.join(tmpDir, "repospec.html");
  const host = await createPluginHost({ repoDir: sampleRepo, includeBuiltins: true });
  try {
    const started = performance.now();
    const scanRes = await host.scan(sampleRepo, { dbPath: path.join(tmpDir, "synthetic.sqlite") });
    fs.writeFileSync(htmlPath, host.renderStudio(scanRes), "utf8");
    const server = startStudioServer({ targetPath: htmlPath, port: 0 });
    try {
      const res = await fetch(server.url);
      if (res.status !== 200) throw new Error(`Synthetic probe failed with HTTP ${res.status}`);
      const body = await res.text();
      if (!body.includes("repospec-data")) throw new Error("Synthetic probe missing repospec-data payload");
      const elapsedMs = Math.round(performance.now() - started);
      console.log(JSON.stringify({ ok: true, probe: "studio-synthetic", digest: scanRes.digest, elapsedMs }));
    } finally {
      server.stop();
    }
  } finally {
    await host.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

await runSyntheticProbe();
