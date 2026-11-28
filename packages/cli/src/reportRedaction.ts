import fs from "node:fs";
import path from "node:path";

export type ReportKind = "fp" | "fn" | "crash" | "bug";

export interface ReportEvidenceHit {
  ruleId: string;
  severity: string;
  subject: string;
  detail: string;
  file: string;
  line: number;
}

export interface ToolFeedbackEntry {
  schemaVersion: 1;
  tool: string;
  runtime: string;
  platform: string;
  kind: ReportKind;
  ruleId: string | null;
  file: string | null;
  line: number | null;
  language: string | null;
  command: string | null;
  reason: string;
  anonymized: boolean;
  evidence: ReportEvidenceHit | null;
  snippet: string | null;
}

const REPO_SLUG = "a1ter-nate/repospec";
const MAX_GITHUB_URL_CHARS = 7400;

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".rs": "rust",
  ".py": "python",
  ".cs": "csharp",
  ".sql": "sql",
  ".tf": "hcl",
  ".tfvars": "hcl",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".json": "json",
  ".md": "markdown",
};

const CODE_KEYWORDS = new Set([
  "abstract", "as", "async", "await", "bool", "boolean", "break", "case", "catch", "class",
  "const", "continue", "crate", "def", "default", "do", "elif", "else", "enum", "except",
  "export", "extends", "false", "finally", "fn", "for", "from", "function", "get", "if",
  "impl", "implements", "import", "in", "int", "interface", "is", "let", "loop", "match",
  "mod", "mut", "namespace", "new", "nil", "none", "null", "number", "object", "of",
  "override", "package", "pass", "private", "protected", "pub", "public", "raise", "readonly",
  "record", "ref", "return", "self", "Self", "set", "static", "str", "string", "struct",
  "super", "switch", "this", "throw", "trait", "true", "try", "type", "typeof", "undefined",
  "use", "using", "var", "void", "where", "while", "with", "yield", "Promise", "Array",
  "Map", "Set", "Error", "Response", "Request", "fetch", "console", "process", "env",
]);

function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function inferLanguageFromPath(filePath: string | null): string | null {
  if (!filePath) return null;
  const ext = path.extname(filePath).toLowerCase();
  return LANG_BY_EXT[ext] ?? null;
}

export function redactSensitiveText(input: string, repoRoot?: string): string {
  let out = input;
  if (repoRoot) {
    const absNorm = path.resolve(repoRoot).replace(/\\/g, "/");
    const absWin = path.resolve(repoRoot).replace(/\//g, "\\");
    out = out.replace(new RegExp(escapeRegex(absNorm), "g"), "<repo>");
    out = out.replace(new RegExp(escapeRegex(absWin), "g"), "<repo>");
  }
  out = out.replace(/\/(?:Users|home)\/[A-Za-z0-9._-]+(?:\/[^\s"'`),;:]*)?/g, (match) => {
    const segs = match.split("/").filter(Boolean);
    const tail = segs.length > 3 ? `/${segs.slice(3).join("/")}` : "";
    return `<repo>${tail}`;
  });
  out = out.replace(/[A-Za-z]:\\Users\\[A-Za-z0-9._-]+(?:\\[^\s"'`),;:]*)?/g, (match) => {
    const segs = match.split("\\").filter(Boolean);
    const tail = segs.length > 3 ? `/${segs.slice(3).join("/")}` : "";
    return `<repo>${tail}`;
  });
  out = out.replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi, "$1<redacted>$3");
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer <redacted>");
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "<redacted-jwt>");
  out = out.replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, "<redacted-token>");
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<redacted-token>");
  out = out.replace(/\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g, "<redacted-key>");
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, "<redacted-aws-key>");
  out = out.replace(
    /(\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY)\s*[:=]\s*["']?)([^"'\s,;]+)/gi,
    "$1<redacted>",
  );
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<redacted-email>");
  return out;
}

export function anonymizeSnippet(snippet: string): string {
  const stringMasked = snippet
    .replace(/`(?:\\.|[^`\\])*`/g, '"<str>"')
    .replace(/"(?:\\.|[^"\\])*"/g, '"<str>"')
    .replace(/'(?:\\.|[^'\\])*'/g, '"<str>"');

  const identMap = new Map<string, string>();
  let idSeq = 0;
  let fnSeq = 0;

  return stringMasked.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b(\s*\()?/g, (full, ident: string, paren?: string) => {
    if (CODE_KEYWORDS.has(ident) || ident === "str" || ident === "redacted") {
      return full;
    }
    let mapped = identMap.get(ident);
    if (!mapped) {
      if (paren) {
        fnSeq += 1;
        mapped = `fn${fnSeq}`;
      } else {
        idSeq += 1;
        mapped = `id${idSeq}`;
      }
      identMap.set(ident, mapped);
    }
    return paren ? `${mapped}${paren}` : mapped;
  });
}

export function extractFileSnippet(
  repoDir: string,
  fileArg: string,
  anonymize: boolean,
): { relPath: string; line: number | null; language: string | null; snippet: string | null } {
  const lineMatch = fileArg.match(/^(.+):(\d+)$/);
  const rawPath = lineMatch?.[1] ? lineMatch[1] : fileArg;
  const lineNum = lineMatch?.[2] ? Math.max(1, Number.parseInt(lineMatch[2], 10)) : null;
  const absRepo = path.resolve(repoDir);
  const absFile = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(absRepo, rawPath);
  const relRaw = path.relative(absRepo, absFile).replace(/\\/g, "/");
  const relPath = relRaw.startsWith("..") ? redactSensitiveText(absFile, absRepo) : relRaw;
  const language = inferLanguageFromPath(relPath);

  if (!fs.existsSync(absFile) || !fs.statSync(absFile).isFile()) {
    return { relPath, line: lineNum, language, snippet: null };
  }

  const lines = fs.readFileSync(absFile, "utf8").split(/\r?\n/);
  const center = lineNum ?? 1;
  const startIdx = Math.max(0, center - 9);
  const endIdx = Math.min(lines.length, lineNum ? center + 8 : 17);
  const sliced = lines.slice(startIdx, endIdx).join("\n");
  const redacted = redactSensitiveText(sliced, absRepo);
  const processed = anonymize ? anonymizeSnippet(redacted) : redacted;
  const numbered = processed
    .split("\n")
    .map((text, idx) => {
      const n = startIdx + idx + 1;
      const mark = lineNum === n ? ">" : " ";
      return `${mark}${String(n).padStart(4, " ")} | ${text}`;
    })
    .join("\n");

  return { relPath, line: lineNum, language, snippet: numbered };
}

export function buildReportTitle(entry: ToolFeedbackEntry): string {
  const prefix = entry.kind === "fp" ? "FP" : entry.kind === "fn" ? "FN" : entry.kind === "crash" ? "Crash" : "Bug";
  const subject = entry.ruleId ?? (entry.command ? entry.command.slice(0, 48) : entry.file ?? "general");
  const shortReason = entry.reason ? `: ${entry.reason.slice(0, 72)}` : "";
  return `[${prefix}] ${subject}${shortReason}`;
}

export function renderReportMarkdown(entry: ToolFeedbackEntry): string {
  const lines: string[] = [
    `## ${entry.kind === "fp" ? "False Positive Report" : entry.kind === "fn" ? "False Negative Report" : entry.kind === "crash" ? "Crash Report" : "Bug Report"}`,
    "",
    `- **Tool:** \`${entry.tool}\``,
    `- **Runtime:** \`${entry.runtime}\` (\`${entry.platform}\`)`,
    `- **Kind:** \`${entry.kind}\``,
  ];
  if (entry.ruleId) lines.push(`- **Rule:** \`${entry.ruleId}\``);
  if (entry.file) lines.push(`- **File:** \`${entry.file}${entry.line ? `:${entry.line}` : ""}\``);
  if (entry.language) lines.push(`- **Language:** \`${entry.language}\``);
  if (entry.command) lines.push(`- **Command:** \`${entry.command}\``);
  if (entry.anonymized) lines.push("- **Snippet Privacy:** Anonymized (`--anonymize`)");

  lines.push("", "### Why This Looks Wrong / Expected Behavior", entry.reason || "_Describe why this finding or behavior is unexpected._");

  if (entry.evidence) {
    lines.push(
      "",
      "### Captured Evidence (from `.repospec/repospec.sqlite`)",
      `- **Rule:** \`${entry.evidence.ruleId}\` (\`${entry.evidence.severity}\`)`,
      `- **Subject:** \`${entry.evidence.subject}\``,
      `- **Location:** \`${entry.evidence.file}:${entry.evidence.line}\``,
      `- **Detail:** ${entry.evidence.detail}`,
    );
  }

  if (entry.snippet) {
    lines.push("", "### Minimal Redacted Snippet", `\`\`\`${entry.language ?? ""}`, entry.snippet, "```");
  }

  lines.push("", "---", "_Generated locally with `repospec report` (paths and secrets scrubbed)._");
  return `${lines.join("\n")}\n`;
}

export function renderRollupMarkdown(entries: readonly ToolFeedbackEntry[]): string {
  const groups = new Map<string, ToolFeedbackEntry[]>();
  for (const item of entries) {
    const key = `${item.kind}::${item.ruleId ?? "general"}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const first = entries[0];
  const lines: string[] = [
    `## RepoSpec Feedback Roll-up (${entries.length} queued item${entries.length === 1 ? "" : "s"} across ${groups.size} group${groups.size === 1 ? "" : "s"})`,
    "",
    `- **Tool:** \`${first?.tool ?? "repospec"}\``,
    `- **Runtime:** \`${first?.runtime ?? "bun"}\` (\`${first?.platform ?? process.platform}\`)`,
  ];

  for (const [, group] of Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const head = group[0];
    if (!head) continue;
    lines.push("", `### [${head.kind.toUpperCase()}] \`${head.ruleId ?? "general"}\` (${group.length})`);
    for (const item of group) {
      const loc = item.file ? `\`${item.file}${item.line ? `:${item.line}` : ""}\`` : "`<no-file>`";
      lines.push(`- ${loc}${item.language ? ` (${item.language})` : ""}: ${item.reason || item.evidence?.detail || "No reason supplied"}`);
      if (item.snippet) {
        lines.push(`\`\`\`${item.language ?? ""}`, item.snippet, "```");
      }
    }
  }

  lines.push("", "---", "_Generated locally with `repospec report --flush` (paths and secrets scrubbed)._");
  return `${lines.join("\n")}\n`;
}

export function buildGithubIssueUrl(params: {
  kind: ReportKind;
  title: string;
  body: string;
}): { url: string; truncated: boolean } {
  const isFp = params.kind === "fp" || params.kind === "fn";
  const template = isFp ? "false-positive.yml" : "bug-report.yml";
  const label = isFp ? "false-positive" : "bug";
  const base = `https://github.com/${REPO_SLUG}/issues/new`;
  const encodeUrl = (bodyText: string): string => {
    const qs = new URLSearchParams({
      template,
      labels: label,
      title: params.title,
      body: bodyText,
    });
    return `${base}?${qs.toString()}`;
  };

  const fullUrl = encodeUrl(params.body);
  if (fullUrl.length <= MAX_GITHUB_URL_CHARS) {
    return { url: fullUrl, truncated: false };
  }

  const notice = "\n\n_(Truncated to fit GitHub URL length limit; run `repospec report --out report.md` for full details.)_";
  let low = 0;
  let high = params.body.length;
  let best = encodeUrl(notice);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = encodeUrl(`${params.body.slice(0, mid)}${notice}`);
    if (candidate.length <= MAX_GITHUB_URL_CHARS) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return { url: best, truncated: true };
}
