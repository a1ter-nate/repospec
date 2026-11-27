import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPOSPEC_ROOT = path.resolve(import.meta.dir, "../..");
const SAMPLE_APP = path.join(REPOSPEC_ROOT, "tests/fixtures/sample-app");
const EXAMPLE_PLUGIN = path.join(REPOSPEC_ROOT, "examples/plugins/hotspot-radar");

interface CliOut {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[]): CliOut {
  const proc = Bun.spawnSync(["bun", path.join(REPOSPEC_ROOT, "src/cli.ts"), ...args], {
    cwd: REPOSPEC_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode ?? 1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("R7 Thin Golden-Path CLI E2E", () => {
  let tmpDir = "";
  let baseOut = "";
  let onOut = "";
  let offOut = "";
  let genRes: CliOut = { exitCode: 1, stdout: "", stderr: "" };
  let valRes: CliOut = { exitCode: 1, stdout: "", stderr: "" };
  let queryRes: CliOut = { exitCode: 1, stdout: "", stderr: "" };
  let onGenRes: CliOut = { exitCode: 1, stdout: "", stderr: "" };
  let offGenRes: CliOut = { exitCode: 1, stdout: "", stderr: "" };

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-e2e-"));
    baseOut = path.join(tmpDir, "base");
    onOut = path.join(tmpDir, "toggle-on");
    offOut = path.join(tmpDir, "toggle-off");
    genRes = runCli(["generate", SAMPLE_APP, "--out", baseOut]);
    valRes = runCli(["validate", path.join(baseOut, "repospec.json")]);
    queryRes = runCli(["query", path.join(baseOut, "repospec.sqlite"), "SELECT count(*) AS cnt FROM nodes"]);
    onGenRes = runCli(["generate", SAMPLE_APP, "--out", onOut, "--plugin", EXAMPLE_PLUGIN]);
    offGenRes = runCli([
      "generate",
      SAMPLE_APP,
      "--out",
      offOut,
      "--plugin",
      EXAMPLE_PLUGIN,
      "--disable-plugin",
      "example.hotspot-radar",
    ]);
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("golden path: CLI generate persists IR/SQLite/HTML and fresh-read validate + query succeed", () => {
    expect(genRes.exitCode).toBe(0);
    expect(fs.existsSync(path.join(baseOut, "repospec.json"))).toBe(true);
    expect(fs.existsSync(path.join(baseOut, "repospec.sqlite"))).toBe(true);
    expect(fs.existsSync(path.join(baseOut, "repospec.html"))).toBe(true);
    expect(valRes.exitCode).toBe(0);
    expect(JSON.parse(valRes.stdout).valid).toBe(true);
    expect(queryRes.exitCode).toBe(0);
    expect(Array.isArray(JSON.parse(queryRes.stdout))).toBe(true);
  });

  test("golden path: CLI --plugin ON adds Studio tab & facts and --disable-plugin restores exact baseline SHA-256", () => {
    const baseParsed = JSON.parse(genRes.stdout) as { digest: string };
    const onParsed = JSON.parse(onGenRes.stdout) as { digest: string };
    const offParsed = JSON.parse(offGenRes.stdout) as { digest: string };
    expect(onParsed.digest).not.toBe(baseParsed.digest);
    expect(offParsed.digest).toBe(baseParsed.digest);
    expect(fs.readFileSync(path.join(onOut, "repospec.html"), "utf8")).toContain("Hotspot Radar");
    expect(fs.readFileSync(path.join(offOut, "repospec.html"), "utf8")).not.toContain("Hotspot Radar");
  });
});
