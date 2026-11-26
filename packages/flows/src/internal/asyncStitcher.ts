import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type {
  AsyncEndpointRef,
  AsyncHandoff,
  DeclarativeFlowAnchor,
  TelemetryOverlayRecord,
  WorkFlowRecord,
} from "./types.ts";

const TEST_FILE_RE = /(?:__tests__|\.test\.|\.spec\.|\/tests?\/|fixtures\/)/i;

interface RawAsyncEndpoint {
  role: "producer" | "consumer";
  channel: string;
  transport: AsyncHandoff["transport"];
  delivery: AsyncHandoff["delivery"];
  ref: AsyncEndpointRef;
}

function lineAtOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function languageOf(relFile: string): string {
  if (relFile.endsWith(".kt") || relFile.endsWith(".kts")) return "kotlin";
  if (relFile.endsWith(".swift")) return "swift";
  if (relFile.endsWith(".py")) return "python";
  if (relFile.endsWith(".tf")) return "hcl";
  if (relFile.endsWith(".yml") || relFile.endsWith(".yaml")) return "yaml";
  return "typescript";
}

function normalizeChannel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function channelTokens(channel: string): string[] {
  const body = channel.split(":")[1] ?? "";
  const stop = new Set(["notify", "notification", "event", "change", "update", "listener", "handler"]);
  const parts = body.split(/[-_/]+/).filter((w) => w.length >= 4 && !stop.has(w));
  if (parts.length > 0) return parts;
  return body.length >= 4 ? [body.slice(0, 6)] : [];
}

function splitCamelToChannel(raw: string): string {
  return normalizeChannel(raw.replace(/([a-z0-9])([A-Z])/g, "$1-$2"));
}

function scanFileForAsyncEndpoints(relFile: string, text: string): RawAsyncEndpoint[] {
  if (TEST_FILE_RE.test(relFile)) return [];
  const lang = languageOf(relFile);
  const out: RawAsyncEndpoint[] = [];

  for (const m of text.matchAll(/\b(send[A-Z][A-Za-z0-9]*(?:Notification|SilentUpdate|Push))\s*\(/g)) {
    const fn = m[1];
    if (!fn) continue;
    const ch = splitCamelToChannel(fn.replace(/^send/, "").replace(/(?:Notification|SilentUpdate|Push)$/, "")) || "fcm";
    out.push({
      role: "producer",
      channel: `fcm:${ch}`,
      transport: "fcm",
      delivery: "best-effort",
      ref: { fn, file: relFile, line: lineAtOffset(text, m.index ?? 0), language: lang },
    });
  }

  if (lang === "kotlin" || lang === "swift") {
    for (const m of text.matchAll(/(?:class|object|struct)\s+([A-Za-z0-9_]*(?:StatusChange|Notification|Fcm|Push)[A-Za-z0-9_]*Listener[A-Za-z0-9_]*)/g)) {
      const cls = m[1];
      if (!cls) continue;
      const ch = splitCamelToChannel(cls.replace(/(?:Listener|Impl|Change|Fcm|Push)/g, "")) || "fcm";
      out.push({
        role: "consumer",
        channel: `fcm:${ch}`,
        transport: "fcm",
        delivery: "best-effort",
        ref: { fn: cls, file: relFile, line: lineAtOffset(text, m.index ?? 0), language: lang },
      });
    }
  }

  for (const m of text.matchAll(/\b(?:pubsub|topic)\s*\(\s*["']([^"']+)["']\s*\)\.(?:publish|publishMessage)/g)) {
    const topic = m[1];
    if (!topic) continue;
    out.push({
      role: "producer",
      channel: `pubsub:${normalizeChannel(topic)}`,
      transport: "pubsub",
      delivery: "at-least-once",
      ref: { fn: `publish(${topic})`, file: relFile, line: lineAtOffset(text, m.index ?? 0), language: lang },
    });
  }

  for (const m of text.matchAll(/\bonMessagePublished\s*\(\s*["']([^"']+)["']/g)) {
    const topic = m[1];
    if (!topic) continue;
    out.push({
      role: "consumer",
      channel: `pubsub:${normalizeChannel(topic)}`,
      transport: "pubsub",
      delivery: "at-least-once",
      ref: { fn: `onMessagePublished(${topic})`, file: relFile, line: lineAtOffset(text, m.index ?? 0), language: lang },
    });
  }

  for (const m of text.matchAll(/\b(onDocument(?:Written|Updated|Created|Deleted))\s*\(\s*["']([^"']+)["']/g)) {
    const fn = m[1];
    const docPath = m[2];
    if (!fn || !docPath) continue;
    const coll = normalizeChannel(docPath.split("/")[0] ?? docPath);
    out.push({
      role: "consumer",
      channel: `firestore:${coll}`,
      transport: "firestore_trigger",
      delivery: "at-least-once",
      ref: { fn: `${fn}(${docPath})`, file: relFile, line: lineAtOffset(text, m.index ?? 0), language: lang },
    });
  }

  for (const m of text.matchAll(/resource\s+"google_cloud_scheduler_job"\s+"([^"]+)"[\s\S]{0,600}?uri\s*=\s*"([^"]+)"/g)) {
    const jobName = m[1];
    const uri = m[2];
    if (!jobName || !uri) continue;
    out.push({
      role: "producer",
      channel: `cron:${normalizeChannel(jobName)}`,
      transport: "cron",
      delivery: "scheduled",
      ref: { fn: `scheduler:${jobName} -> ${uri}`, file: relFile, line: lineAtOffset(text, m.index ?? 0), language: "hcl" },
    });
  }

  return out;
}

export function extractAsyncHandoffs(
  repoDir: string,
  relFiles: readonly string[],
): AsyncHandoff[] {
  const endpoints: RawAsyncEndpoint[] = [];
  for (const rel of relFiles) {
    if (!/\.(?:ts|tsx|js|mjs|kt|swift|py|tf)$/.test(rel)) continue;
    if (TEST_FILE_RE.test(rel)) continue;
    const abs = path.join(repoDir, rel);
    if (!fs.existsSync(abs)) continue;
    let text = "";
    try {
      const stat = fs.statSync(abs);
      if (stat.size > 350_000) continue;
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    endpoints.push(...scanFileForAsyncEndpoints(rel, text));
  }

  const producers = endpoints.filter((e) => e.role === "producer");
  const consumers = endpoints.filter((e) => e.role === "consumer");
  const consumerByExact = new Map<string, RawAsyncEndpoint>();
  const consumerByToken = new Map<string, RawAsyncEndpoint>();
  for (const c of consumers) {
    const exactKey = `${c.transport}|${c.channel}`;
    if (!consumerByExact.has(exactKey)) consumerByExact.set(exactKey, c);
    for (const tok of channelTokens(c.channel)) {
      const tk = `${c.transport}|${tok}`;
      if (!consumerByToken.has(tk)) consumerByToken.set(tk, c);
    }
  }
  const handoffs: AsyncHandoff[] = [];
  const seen = new Set<string>();

  for (const prod of producers) {
    let matched = consumerByExact.get(`${prod.transport}|${prod.channel}`);
    if (!matched) {
      for (const tok of channelTokens(prod.channel)) {
        const cand = consumerByToken.get(`${prod.transport}|${tok}`);
        if (cand) {
          matched = cand;
          break;
        }
      }
    }
    const key = `${prod.channel}|${prod.ref.file}:${prod.ref.line}|${matched?.ref.file ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry: AsyncHandoff = {
      channel: prod.channel,
      transport: prod.transport,
      delivery: prod.delivery,
      producer: prod.ref,
    };
    if (matched) entry.consumer = matched.ref;
    handoffs.push(entry);
  }

  return handoffs
    .sort((a, b) => Number(Boolean(b.consumer)) - Number(Boolean(a.consumer)) || a.channel.localeCompare(b.channel))
    .slice(0, 60);
}

export function loadDeclarativeFlowAnchors(repoDir: string): DeclarativeFlowAnchor[] {
  for (const name of ["flows.yaml", "flows.yml"]) {
    const abs = path.join(repoDir, ".repospec", name);
    if (!fs.existsSync(abs)) continue;
    try {
      const raw = yaml.load(fs.readFileSync(abs, "utf8")) as { journeys?: unknown[] } | null;
      if (!raw || !Array.isArray(raw.journeys)) return [];
      const out: DeclarativeFlowAnchor[] = [];
      for (const item of raw.journeys) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const id = typeof rec.id === "string" ? rec.id.trim() : "";
        const nameVal = typeof rec.name === "string" ? rec.name.trim() : id;
        const entryFile = typeof rec.entryFile === "string" ? rec.entryFile.trim() : "";
        if (!id || !entryFile) continue;
        const anchor: DeclarativeFlowAnchor = { id, name: nameVal, entryFile };
        if (typeof rec.entryFn === "string" && rec.entryFn.trim()) anchor.entryFn = rec.entryFn.trim();
        if (Array.isArray(rec.tags)) anchor.tags = rec.tags.map(String);
        out.push(anchor);
      }
      return out;
    } catch {
      return [];
    }
  }
  return [];
}

export function loadTelemetryOverlay(telemetryPath: string): TelemetryOverlayRecord[] {
  if (!fs.existsSync(telemetryPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(telemetryPath, "utf8")) as unknown;
    const arr = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { spans?: unknown[] }).spans)
        ? (raw as { spans: unknown[] }).spans
        : [];
    const out: TelemetryOverlayRecord[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const rec: TelemetryOverlayRecord = {};
      if (typeof r.spanName === "string") rec.spanName = r.spanName;
      if (typeof r.file === "string") rec.file = r.file;
      if (typeof r.fn === "string") rec.fn = r.fn;
      if (typeof r.p50Ms === "number" && Number.isFinite(r.p50Ms)) rec.p50Ms = r.p50Ms;
      if (typeof r.p95Ms === "number" && Number.isFinite(r.p95Ms)) rec.p95Ms = r.p95Ms;
      if (typeof r.rps === "number" && Number.isFinite(r.rps)) rec.rps = r.rps;
      out.push(rec);
    }
    return out;
  } catch {
    return [];
  }
}

export function applyTelemetryOverlay(
  flows: readonly WorkFlowRecord[],
  records: readonly TelemetryOverlayRecord[],
): WorkFlowRecord[] {
  if (records.length === 0) return [...flows];
  return flows.map((flow) => {
    const flowMatch = records.find(
      (r) =>
        (r.fn && (r.fn === flow.name || r.fn === flow.entryFn)) ||
        (r.file && (flow.file === r.file || flow.file.endsWith(r.file))) ||
        (r.spanName && flow.steps.some((s) => s.op === "span" && s.target === r.spanName)),
    );
    const updatedSteps = flow.steps.map((step) => {
      const m = records.find(
        (r) =>
          (r.spanName && (step.target === r.spanName || step.fn === r.spanName)) ||
          (r.fn && (step.fn === r.fn || step.fn.endsWith(`.${r.fn}`))),
      );
      if (!m) return step;
      return {
        ...step,
        latencyMsP50: m.p50Ms ?? step.latencyMsP50,
        latencyMsP95: m.p95Ms ?? step.latencyMsP95,
        rps: m.rps ?? step.rps,
      };
    });
    const next: WorkFlowRecord = { ...flow, steps: updatedSteps };
    if (flowMatch && (flowMatch.p50Ms !== undefined || flowMatch.p95Ms !== undefined || flowMatch.rps !== undefined)) {
      next.telemetry = {
        p50Ms: flowMatch.p50Ms,
        p95Ms: flowMatch.p95Ms,
        rps: flowMatch.rps,
      };
    }
    return next;
  });
}
