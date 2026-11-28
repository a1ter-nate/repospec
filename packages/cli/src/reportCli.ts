import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CliUsageError } from "@repospec/plugin";
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import {
  anonymizeSnippet,
  buildGithubIssueUrl,
  buildReportTitle,
  extractFileSnippet,
  redactSensitiveText,
  renderReportMarkdown,
  renderRollupMarkdown,
  type ReportEvidenceHit,
  type ReportKind,
  type ToolFeedbackEntry,
} from "./reportRedaction.ts";

const UPSTREAM_REPO = "a1ter-nate/repospec";
const FEEDBACK_REL_PATH = path.join(".verification", "tool-feedback.jsonl");

export interface ReportCommandOptions {
  repoDir?: string;
  rule?: string;
  file?: string;
  kind?: string;
  reason?: string;
  command?: string;
  anonymize?: boolean;
  local?: boolean;
  flush?: boolean;
  clear?: boolean;
  submit?: boolean;
  url?: boolean;
  out?: string;
  json?: boolean;
  ghRunner?: (args: string[]) => { ok: boolean; stdout: string; stderr: string };
}

export type ReportCommandResult =
  | {
      mode: "local";
      title: string;
      markdown: string;
      entry: ToolFeedbackEntry;
      queuedCount: number;
      queuePath: string;
    }
  | {
      mode: "flush";
      title: string;
      markdown: string;
      entries: ToolFeedbackEntry[];
      queuedCount: number;
      queuePath: string;
      queueCleared: boolean;
      issueUrl?: string;
      urlTruncated?: boolean;
      outPath?: string;
    }
  | {
      mode: "url";
      title: string;
      markdown: string;
      issueUrl: string;
      urlTruncated: boolean;
      entry?: ToolFeedbackEntry;
      entries?: ToolFeedbackEntry[];
    }
  | {
      mode: "out";
      title: string;
      markdown: string;
      outPath: string;
      issueUrl: string;
      urlTruncated: boolean;
      entry?: ToolFeedbackEntry;
      entries?: ToolFeedbackEntry[];
    }
  | {
      mode: "submit";
      title: string;
      markdown: string;
      submitted: boolean;
      issueUrl: string;
      urlTruncated: boolean;
      fallbackReason?: string;
      queueCleared?: boolean;
      queuePath?: string;
      outPath?: string;
    }
  | {
      mode: "dry-run";
      title: string;
      markdown: string;
      entry: ToolFeedbackEntry;
      issueUrl: string;
      urlTruncated: boolean;
    };

function readToolVersion(): string {
  const candidates = [
    path.resolve(import.meta.dir, "../../../package.json"),
    path.resolve(import.meta.dir, "../../package.json"),
    path.resolve(import.meta.dir, "../package.json"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as { name?: string; version?: string };
      if (parsed.name === "repospec" && typeof parsed.version === "string" && parsed.version.length > 0) {
        return `repospec@${parsed.version}`;
      }
    } catch {
      continue;
    }
  }
  return "repospec@5.0.1";
}

function normalizeKind(raw?: string): ReportKind {
  if (raw === "fp" || raw === "fn" || raw === "crash" || raw === "bug") return raw;
  return "fp";
}

function findMatchingSqliteEvidence(
  repoDir: string,
  ruleId: string | null,
  relFile: string | null,
  line: number | null,
): ReportEvidenceHit | null {
  if (!ruleId && !relFile) return null;
  const dbPath = path.join(path.resolve(repoDir), ".repospec", "repospec.sqlite");
  if (!fs.existsSync(dbPath)) return null;
  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const rows = db
      .query(
        "SELECT rule_id, severity, subject, detail, file, line FROM invariant_evidence WHERE (?1 IS NULL OR rule_id = ?1) AND (?2 IS NULL OR file = ?2) ORDER BY CASE WHEN ?3 IS NOT NULL AND line = ?3 THEN 0 ELSE 1 END, line ASC LIMIT 1",
      )
      .all(ruleId, relFile, line) as Array<{
      rule_id: string;
      severity: string;
      subject: string;
      detail: string;
      file: string;
      line: number;
    }>;
    const hit = rows[0];
    if (!hit) return null;
    return {
      ruleId: String(hit.rule_id),
      severity: String(hit.severity),
      subject: redactSensitiveText(String(hit.subject), repoDir),
      detail: redactSensitiveText(String(hit.detail), repoDir),
      file: redactSensitiveText(String(hit.file), repoDir),
      line: Number(hit.line ?? 1),
    };
  } catch {
    return null;
  } finally {
    if (db) db.close();
  }
}

function defaultGhRunner(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync("gh", args, { encoding: "utf8" });
  return {
    ok: !res.error && res.status === 0,
    stdout: (res.stdout ?? "").trim(),
    stderr: (res.stderr ?? "").trim() || (res.error ? String(res.error.message ?? res.error) : ""),
  };
}

function readFeedbackQueue(queuePath: string): ToolFeedbackEntry[] {
  if (!fs.existsSync(queuePath)) return [];
  const raw = fs.readFileSync(queuePath, "utf8");
  const out: ToolFeedbackEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as ToolFeedbackEntry);
    } catch {
      continue;
    }
  }
  return out;
}

function dedupeFeedbackEntries(entries: readonly ToolFeedbackEntry[]): ToolFeedbackEntry[] {
  const seen = new Set<string>();
  const out: ToolFeedbackEntry[] = [];
  for (const item of entries) {
    const key = [item.kind, item.ruleId ?? "", item.file ?? "", String(item.line ?? ""), item.reason].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function buildReportEntry(opts: ReportCommandOptions): ToolFeedbackEntry {
  const absRepo = path.resolve(opts.repoDir ?? ".");
  const kind = normalizeKind(opts.kind);
  const anonymize = Boolean(opts.anonymize);
  const extracted = opts.file ? extractFileSnippet(absRepo, opts.file, anonymize) : null;
  const ruleId = opts.rule ? opts.rule.trim() : null;
  const rawEvidence = findMatchingSqliteEvidence(absRepo, ruleId, extracted?.relPath ?? null, extracted?.line ?? null);
  const evidence =
    rawEvidence && anonymize
      ? {
          ...rawEvidence,
          subject: anonymizeSnippet(rawEvidence.subject),
          detail: anonymizeSnippet(rawEvidence.detail),
        }
      : rawEvidence;
  const runtime = typeof Bun !== "undefined" ? `bun@${Bun.version}` : `node@${process.version}`;

  return {
    schemaVersion: 1,
    tool: readToolVersion(),
    runtime,
    platform: `${process.platform}/${process.arch}`,
    kind,
    ruleId,
    file: extracted?.relPath ?? null,
    line: extracted?.line ?? null,
    language: extracted?.language ?? null,
    command: opts.command ? redactSensitiveText(opts.command, absRepo) : null,
    reason: redactSensitiveText(opts.reason ?? "", absRepo),
    anonymized: anonymize,
    evidence,
    snippet: extracted?.snippet ?? null,
  };
}

export function formatReportHintFooter(ruleId?: string, fileLoc?: string, kind?: ReportKind): string {
  const parts = ["repospec report"];
  if (kind && kind !== "fp") parts.push(`--kind ${kind}`);
  if (ruleId) parts.push(`--rule ${ruleId}`);
  if (fileLoc) parts.push(`--file ${fileLoc}`);
  return `False positive or tool bug? Run: ${parts.join(" ")}`;
}

export function runReportCommand(opts: ReportCommandOptions): ReportCommandResult {
  const absRepo = path.resolve(opts.repoDir ?? ".");
  const queuePath = path.join(absRepo, FEEDBACK_REL_PATH);
  const ghRun = opts.ghRunner ?? defaultGhRunner;

  if (opts.local) {
    const entry = buildReportEntry(opts);
    fs.mkdirSync(path.dirname(queuePath), { recursive: true });
    fs.appendFileSync(queuePath, `${JSON.stringify(entry)}\n`, "utf8");
    const total = readFeedbackQueue(queuePath).length;
    return {
      mode: "local",
      title: buildReportTitle(entry),
      markdown: renderReportMarkdown(entry),
      entry,
      queuedCount: total,
      queuePath: FEEDBACK_REL_PATH,
    };
  }

  let title: string;
  let markdown: string;
  let kind: ReportKind;
  let entry: ToolFeedbackEntry | undefined;
  let entries: ToolFeedbackEntry[] | undefined;

  if (opts.flush) {
    entries = dedupeFeedbackEntries(readFeedbackQueue(queuePath));
    if (entries.length === 0) {
      return {
        mode: "flush",
        title: "No queued RepoSpec feedback",
        markdown: "No queued feedback entries found in `.verification/tool-feedback.jsonl`.\n",
        entries: [],
        queuedCount: 0,
        queuePath: FEEDBACK_REL_PATH,
        queueCleared: false,
      };
    }
    kind = entries.every((e) => e.kind === "fp" || e.kind === "fn") ? "fp" : "bug";
    title = `[Feedback Roll-up] ${entries.length} scrubbed RepoSpec finding(s)`;
    markdown = renderRollupMarkdown(entries);
  } else {
    entry = buildReportEntry(opts);
    kind = entry.kind;
    title = buildReportTitle(entry);
    markdown = renderReportMarkdown(entry);
  }

  const issueLink = buildGithubIssueUrl({ kind, title, body: markdown });
  let outPath: string | undefined;
  if (opts.out) {
    outPath = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, markdown, "utf8");
  }

  if (opts.submit) {
    const label = kind === "fp" || kind === "fn" ? "false-positive" : "bug";
    const created = ghRun([
      "issue",
      "create",
      "-R",
      UPSTREAM_REPO,
      "--label",
      label,
      "--title",
      title,
      "--body",
      markdown,
    ]);
    if (created.ok) {
      let queueCleared = false;
      if (opts.flush && fs.existsSync(queuePath)) {
        fs.unlinkSync(queuePath);
        queueCleared = true;
      }
      return {
        mode: "submit",
        title,
        markdown,
        submitted: true,
        issueUrl: created.stdout || issueLink.url,
        urlTruncated: created.stdout ? false : issueLink.truncated,
        queueCleared,
        queuePath: opts.flush ? FEEDBACK_REL_PATH : undefined,
        outPath,
      };
    }
    return {
      mode: "submit",
      title,
      markdown,
      submitted: false,
      issueUrl: issueLink.url,
      urlTruncated: issueLink.truncated,
      fallbackReason: created.stderr || "gh CLI unavailable or not authenticated",
      queueCleared: false,
      queuePath: opts.flush ? FEEDBACK_REL_PATH : undefined,
      outPath,
    };
  }

  let queueCleared = false;
  if (opts.flush && opts.clear && fs.existsSync(queuePath)) {
    fs.unlinkSync(queuePath);
    queueCleared = true;
  }

  if (opts.url) {
    return {
      mode: "url",
      title,
      markdown,
      issueUrl: issueLink.url,
      urlTruncated: issueLink.truncated,
      entry,
      entries,
    };
  }
  if (outPath) {
    return {
      mode: "out",
      title,
      markdown,
      outPath,
      issueUrl: issueLink.url,
      urlTruncated: issueLink.truncated,
      entry,
      entries,
    };
  }
  if (opts.flush && entries) {
    return {
      mode: "flush",
      title,
      markdown,
      entries,
      queuedCount: entries.length,
      queuePath: FEEDBACK_REL_PATH,
      queueCleared,
      issueUrl: issueLink.url,
      urlTruncated: issueLink.truncated,
    };
  }
  return {
    mode: "dry-run",
    title,
    markdown,
    entry: entry ?? buildReportEntry(opts),
    issueUrl: issueLink.url,
    urlTruncated: issueLink.truncated,
  };
}

export const reportCmd = Command.make(
  "report",
  {
    rule: Flag.optional(Flag.String("rule")).pipe(Flag.withDescription("Rule ID being reported")),
    file: Flag.optional(Flag.String("file")).pipe(Flag.withDescription("Target path[:line] for tight redacted snippet")),
    kind: Flag.withDefault(Flag.String("kind"), "fp").pipe(Flag.withDescription("Report kind: fp|fn|crash|bug")),
    reason: Flag.optional(Flag.String("reason")).pipe(Flag.withDescription("Why the finding is wrong or expected behavior")),
    command: Flag.optional(Flag.String("command")).pipe(Flag.withDescription("Optional failing command string")),
    repo: Flag.withDefault(Flag.String("repo"), ".").pipe(Flag.withDescription("Repository root directory")),
    anonymize: Flag.withDefault(Flag.Boolean("anonymize"), false).pipe(Flag.withDescription("Anonymize identifiers and string literals in snippet")),
    local: Flag.withDefault(Flag.Boolean("local"), false).pipe(Flag.withDescription("Append scrubbed entry to .verification/tool-feedback.jsonl")),
    flush: Flag.withDefault(Flag.Boolean("flush"), false).pipe(Flag.withDescription("Roll up queued .verification/tool-feedback.jsonl entries")),
    clear: Flag.withDefault(Flag.Boolean("clear"), false).pipe(Flag.withDescription("Clear queued entries after --flush")),
    submit: Flag.withDefault(Flag.Boolean("submit"), false).pipe(Flag.withDescription("Create upstream GitHub issue via gh CLI")),
    url: Flag.withDefault(Flag.Boolean("url"), false).pipe(Flag.withDescription("Emit pre-filled GitHub issue URL")),
    out: Flag.optional(Flag.String("out")).pipe(Flag.withDescription("Write redacted Markdown report to file")),
    json: Flag.withDefault(Flag.Boolean("json"), false).pipe(Flag.withDescription("Emit structured JSON output")),
  },
  (cfg) =>
    Effect.try({
      try: () =>
        runReportCommand({
          repoDir: cfg.repo,
          rule: Option.getOrUndefined(cfg.rule),
          file: Option.getOrUndefined(cfg.file),
          kind: cfg.kind,
          reason: Option.getOrUndefined(cfg.reason),
          command: Option.getOrUndefined(cfg.command),
          anonymize: cfg.anonymize,
          local: cfg.local,
          flush: cfg.flush,
          clear: cfg.clear,
          submit: cfg.submit,
          url: cfg.url,
          out: Option.getOrUndefined(cfg.out),
          json: cfg.json,
        }),
      catch: (err) => new CliUsageError({ message: err instanceof Error ? err.message : String(err) }),
    }).pipe(
      Effect.tap((res) =>
        Effect.sync(() => {
          if (cfg.json) {
            console.log(JSON.stringify(res, null, 2));
            return;
          }
          if (res.mode === "local") {
            console.log(`Queued scrubbed feedback in ${res.queuePath} (${res.queuedCount} entry/entries queued).`);
            console.log("Next: run `repospec report --flush` to preview the grouped roll-up, or `--flush --submit` / `--flush --url`.");
            return;
          }
          if (res.mode === "url") {
            console.log(res.issueUrl ?? "");
            return;
          }
          if (res.mode === "submit") {
            if (res.submitted) {
              console.log(`Created upstream issue: ${res.issueUrl}`);
              if (res.queueCleared) console.log(`Cleared ${res.queuePath}.`);
            } else {
              console.log(`Could not submit via gh (${res.fallbackReason}).`);
              console.log(`Open pre-filled issue URL instead:\n${res.issueUrl}`);
            }
            return;
          }
          console.log(res.markdown.trimEnd());
          if (res.mode === "out" || (res.mode === "flush" && res.outPath)) {
            console.log(`\nWrote redacted report to ${res.outPath}`);
          } else {
            console.log("\nDry run only (nothing sent). Re-run with `--submit`, `--url`, `--local`, or `--out <file>`.");
          }
        }),
      ),
      Effect.asVoid,
    ),
).pipe(Command.withDescription("Generate, queue, or submit a privacy-scrubbed false-positive or bug report."));
