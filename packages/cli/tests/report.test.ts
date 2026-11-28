import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  anonymizeSnippet,
  buildGithubIssueUrl,
  formatReportHintFooter,
  redactSensitiveText,
  runReportCommand,
} from "@repospec/cli";
import type { ReportCommandResult } from "../src/reportCli.ts";

function expectMode<M extends ReportCommandResult["mode"]>(
  res: ReportCommandResult,
  mode: M,
): Extract<ReportCommandResult, { mode: M }> {
  if (res.mode !== mode) {
    throw new Error(`Expected mode '${mode}', got '${res.mode}'`);
  }
  return res as Extract<ReportCommandResult, { mode: M }>;
}

function writeTmpFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

describe("@repospec/cli report command (Options A + C + E)", () => {
  test("redacts local home/workspace paths, tokens, JWTs, DB passwords, env secrets, and emails", () => {
    const fakeHome = ["", "Users", "alice", "work", "client-app", "src", "auth.ts"].join("/");
    const fakeWin = ["C:", "Users", "bob", "repos", "client", "app.ts"].join("\\");
    const fakeGh = ["ghp", "A".repeat(24)].join("_");
    const fakeAws = ["AKIA", "0123456789ABCDEF"].join("");
    const fakeJwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0In0", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"].join(".");
    const raw = [
      `path=${fakeHome}`,
      `win=${fakeWin}`,
      `auth=Bearer secretTokenValue12345`,
      `gh=${fakeGh}`,
      `aws=${fakeAws}`,
      `jwt=${fakeJwt}`,
      `db=postgres://admin:superSecret99@db.internal:5432/prod`,
      `API_SECRET=mySuperSecret123`,
      `contact=dev@private-corp.example`,
    ].join("\n");

    const scrubbed = redactSensitiveText(raw);
    expect(scrubbed).not.toContain("alice");
    expect(scrubbed).not.toContain("bob");
    expect(scrubbed).not.toContain(fakeGh);
    expect(scrubbed).not.toContain(fakeAws);
    expect(scrubbed).not.toContain(fakeJwt);
    expect(scrubbed).not.toContain("secretTokenValue12345");
    expect(scrubbed).not.toContain("superSecret99");
    expect(scrubbed).not.toContain("mySuperSecret123");
    expect(scrubbed).not.toContain("dev@private-corp.example");
    expect(scrubbed).toContain("<repo>/client-app/src/auth.ts");
    expect(scrubbed).toContain("Bearer <redacted>");
    expect(scrubbed).toContain("postgres://admin:<redacted>@db.internal:5432/prod");
    expect(scrubbed).toContain("<redacted-email>");
  });

  test("anonymizes non-keyword identifiers and string literals while keeping syntax and keywords intact", () => {
    const code = `export async function syncCustomerOrders(tenantSecret: string) {
  const payload = await fetchBillingLedger("acme-internal-url");
  return payload.customerBalance;
}`;
    const anon = anonymizeSnippet(code);
    expect(anon).toContain("export async function fn1(id1: string)");
    expect(anon).toContain('await fn2("<str>")');
    expect(anon).not.toContain("syncCustomerOrders");
    expect(anon).not.toContain("tenantSecret");
    expect(anon).not.toContain("fetchBillingLedger");
    expect(anon).not.toContain("acme-internal-url");
    expect(anon).not.toContain("customerBalance");
  });

  test("clamps pre-filled GitHub issue URLs safely below 7500 chars with a truncation note", () => {
    const hugeBody = "line of diagnostic evidence\n".repeat(400);
    const built = buildGithubIssueUrl({
      kind: "fp",
      title: "[FP] ddia:serial-independent-awaits",
      body: hugeBody,
    });
    expect(built.truncated).toBe(true);
    expect(built.url.length).toBeLessThanOrEqual(7400);
    expect(built.url).toContain("template=false-positive.yml");
    expect(new URL(built.url).searchParams.get("body")).toContain("Truncated to fit GitHub URL length limit");
  });

  test("supports dry-run default, sqlite evidence capture, --out, --submit fallback, and Option C --local/--flush", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-report-"));
    try {
      writeTmpFile(
        tmp,
        "src/api/sync.ts",
        `export async function fetchCustomerInvoices(endpointUrl: string) {
  const token = "Bearer superSecretToken999";
  const res = await fetch(endpointUrl);
  const json = await res.json();
  return { token, json };
}
`,
      );
      const dbDir = path.join(tmp, ".repospec");
      fs.mkdirSync(dbDir, { recursive: true });
      const db = new Database(path.join(dbDir, "repospec.sqlite"));
      db.exec(`CREATE TABLE invariant_evidence (
        rule_id TEXT, severity TEXT, subject TEXT, detail TEXT, file TEXT, line INTEGER
      );`);
      db.query(
        "INSERT INTO invariant_evidence (rule_id, severity, subject, detail, file, line) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        "ddia:blocking-noncritical-io",
        "warn",
        "fetchCustomerInvoices",
        "res.json() treated as server response",
        "src/api/sync.ts",
        4,
      );
      db.close();

      const dry = expectMode(
        runReportCommand({
          repoDir: tmp,
          rule: "ddia:blocking-noncritical-io",
          file: "src/api/sync.ts:4",
          kind: "fp",
          reason: "Client fetch response.json() is not an HTTP server response",
          anonymize: true,
        }),
        "dry-run",
      );
      expect(dry.entry.language).toBe("typescript");
      expect(dry.entry.evidence?.ruleId).toBe("ddia:blocking-noncritical-io");
      expect(dry.markdown).not.toContain("fetchCustomerInvoices");
      expect(dry.markdown).not.toContain("superSecretToken999");
      expect(dry.markdown).toContain('"<str>"');

      const outFile = path.join(tmp, "out", "report.md");
      const written = expectMode(
        runReportCommand({
          repoDir: tmp,
          rule: "ddia:blocking-noncritical-io",
          file: "src/api/sync.ts:4",
          reason: "Client response.json() FP",
          out: outFile,
        }),
        "out",
      );
      expect(written.outPath).toBe(path.resolve(outFile));
      expect(fs.existsSync(outFile)).toBe(true);
      expect(fs.readFileSync(outFile, "utf8")).toContain("ddia:blocking-noncritical-io");

      const fallback = expectMode(
        runReportCommand({
          repoDir: tmp,
          rule: "ddia:blocking-noncritical-io",
          file: "src/api/sync.ts:4",
          reason: "Client response.json() FP",
          submit: true,
          ghRunner: () => ({ ok: false, stdout: "", stderr: "gh: not logged in" }),
        }),
        "submit",
      );
      expect(fallback.submitted).toBe(false);
      expect(fallback.fallbackReason).toContain("not logged in");
      expect(fallback.issueUrl).toContain("https://github.com/a1ter-nate/repospec/issues/new?");

      const q1 = expectMode(
        runReportCommand({
          repoDir: tmp,
          rule: "ddia:blocking-noncritical-io",
          file: "src/api/sync.ts:4",
          reason: "Client response.json() FP",
          anonymize: true,
          local: true,
        }),
        "local",
      );
      const qDup = expectMode(
        runReportCommand({
          repoDir: tmp,
          rule: "ddia:blocking-noncritical-io",
          file: "src/api/sync.ts:4",
          reason: "Client response.json() FP",
          anonymize: true,
          local: true,
        }),
        "local",
      );
      const q2 = expectMode(
        runReportCommand({
          repoDir: tmp,
          rule: "sql:intra-package-module-tangle",
          file: "src/api/sync.ts:1",
          kind: "fn",
          reason: "Missed file-level cycle",
          local: true,
        }),
        "local",
      );
      expect(q1.queuedCount).toBe(1);
      expect(qDup.queuedCount).toBe(2);
      expect(q2.queuedCount).toBe(3);

      const queueFile = path.join(tmp, ".verification", "tool-feedback.jsonl");
      expect(fs.existsSync(queueFile)).toBe(true);

      const flushPreview = expectMode(runReportCommand({ repoDir: tmp, flush: true }), "flush");
      expect(flushPreview.entries.length).toBe(2);
      expect(flushPreview.markdown).toContain("ddia:blocking-noncritical-io");
      expect(flushPreview.markdown).toContain("sql:intra-package-module-tangle");
      expect(fs.existsSync(queueFile)).toBe(true);

      const flushFailSubmit = expectMode(
        runReportCommand({
          repoDir: tmp,
          flush: true,
          submit: true,
          ghRunner: () => ({ ok: false, stdout: "", stderr: "gh unavailable" }),
        }),
        "submit",
      );
      expect(flushFailSubmit.submitted).toBe(false);
      expect(fs.existsSync(queueFile)).toBe(true);

      let receivedArgs: string[] = [];
      const flushOkSubmit = expectMode(
        runReportCommand({
          repoDir: tmp,
          flush: true,
          submit: true,
          ghRunner: (args) => {
            receivedArgs = args;
            return { ok: true, stdout: "https://github.com/a1ter-nate/repospec/issues/999", stderr: "" };
          },
        }),
        "submit",
      );
      expect(flushOkSubmit.submitted).toBe(true);
      expect(flushOkSubmit.queueCleared).toBe(true);
      expect(flushOkSubmit.issueUrl).toBe("https://github.com/a1ter-nate/repospec/issues/999");
      expect(receivedArgs).toContain("a1ter-nate/repospec");
      expect(fs.existsSync(queueFile)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("@repospec/cli report CLI subprocess (Options A + E)", () => {
  let tmp = "";
  let jsonOut = "";
  let jsonExit = -1;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-report-cli-"));
    writeTmpFile(tmp, "src/index.ts", "export const ok = 1;\n");
    const cliEntry = path.resolve(import.meta.dir, "../../../src/cli.ts");
    const res = Bun.spawnSync(
      [
        "bun",
        cliEntry,
        "report",
        "--repo",
        tmp,
        "--rule",
        "sql:env-contract-drift",
        "--file",
        "src/index.ts:1",
        "--reason",
        "Bracket env read FP",
        "--json",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    jsonExit = res.exitCode;
    jsonOut = res.stdout.toString().trim();
  });

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("CLI report --json emits strictly valid JSON with zero extra footer prose", () => {
    expect(jsonExit).toBe(0);
    const parsed = JSON.parse(jsonOut) as { mode: string; entry?: { ruleId: string } };
    expect(parsed.mode).toBe("dry-run");
    expect(parsed.entry?.ruleId).toBe("sql:env-contract-drift");
    expect(formatReportHintFooter("sql:env-contract-drift", "src/index.ts:1")).toBe(
      "False positive or tool bug? Run: repospec report --rule sql:env-contract-drift --file src/index.ts:1",
    );
  });
});
