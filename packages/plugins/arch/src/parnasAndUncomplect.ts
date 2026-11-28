import fs from "node:fs";
import path from "node:path";
import type { ExtractorPlugin, FactRecord, GraphFragment, MetricRecord, RepoContext, UnitDescriptor } from "@repospec/plugin";
import { isExcludedCodePath } from "@repospec/plugin";

const EXTRACTOR_ID = "arch.parnas-uncomplect.v1";
const TEST_RE = /(?:__tests__|\.test\.|\.spec\.|\/tests?\/|_tests?\.rs$|Tests?\.cs$|fixtures\/)/i;
const CODE_EXT_RE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|rs|py|cs)$/;
const PROJECTION_PATH_RE = /(?:^|\/)(?:to-[a-z0-9_-]+|presenter[a-z0-9_-]*|projection[a-z0-9_-]*|view-?model[a-z0-9_-]*|serializer[a-z0-9_-]*|formatters?)\.[a-z]+$/i;
const PERSISTENCE_PATH_RE = /(?:^|\/)(?:dao|repo|repository|repositories|store|storage|db|database|persistence|prisma|sql|clients?|adapters?|integrations?|infra|indexdb)\b/i;

const LEAKED_SECRET_TYPE_RE =
  /\b(DocumentSnapshot|QuerySnapshot|CollectionReference|Firestore|PgPool|SqlitePool|PoolConnection|sqlx::(?:Pool|Transaction|PgRow)|DbContext|DbSet|PrismaClient|AxiosResponse|express\.Request|express\.Response|Octokit|Stripe\.[A-Z]\w+)\b/;

const SOUNDINESS_PATTERNS: ReadonlyArray<{ category: string; re: RegExp; detail: string }> = [
  { category: "dynamic_import", re: /\bimport\s*\(\s*(?!["'`][^"'`$]+["'`]\s*\))[^)]+\)/, detail: "Computed dynamic import() cannot be resolved statically" },
  { category: "eval_or_function", re: /\b(?:eval\s*\(|new\s+Function\s*\()/, detail: "Dynamic code execution (eval / new Function)" },
  { category: "reflection_or_proxy", re: /\b(?:new\s+Proxy\s*\(|Reflect\.(?:apply|construct|get|set)\s*\(|Type\.GetType\s*\(|Assembly\.Load\s*\(|__import__\s*\(|getattr\s*\()/, detail: "Runtime reflection or Proxy indirection" },
  { category: "unsafe_ffi", re: /\bextern\s+"C"\b|\bunsafe\s*\{/, detail: "Unsafe block or FFI boundary" },
];

const COMPETING_CONCERN_GROUPS: ReadonlyArray<{ concern: string; libraries: readonly string[] }> = [
  { concern: "http_client", libraries: ["axios", "got", "ky", "superagent", "node-fetch", "undici", "reqwest", "ureq", "httpx", "requests"] },
  { concern: "schema_validation", libraries: ["zod", "valibot", "yup", "joi", "ajv", "typebox", "arktype"] },
  { concern: "logging", libraries: ["winston", "pino", "bunyan", "log4js"] },
  { concern: "date_time", libraries: ["moment", "dayjs", "luxon", "date-fns"] },
];

interface ExtractedShape {
  name: string;
  file: string;
  line: number;
  unit: string;
  fields: Set<string>;
}

interface RetiringRule {
  path: string;
  allowExisting?: string[];
  replacement?: string;
}

function lineAt(text: string, idx: number): number {
  let ln = 1;
  for (let i = 0; i < idx && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) ln += 1;
  }
  return ln;
}

function unitForFile(rel: string, sortedUnits: readonly UnitDescriptor[], fallback: string): string {
  for (const u of sortedUnits) {
    if (u.dir === "." || rel === u.dir || rel.startsWith(`${u.dir}/`)) return u.name;
  }
  return fallback;
}

function extractExportedShapes(rel: string, unit: string, text: string): ExtractedShape[] {
  const shapes: ExtractedShape[] = [];
  const blockRe =
    rel.endsWith(".rs")
      ? /pub\s+struct\s+([A-Z][A-Za-z0-9_]*)\s*\{([^}]{10,2000})\}/g
      : rel.endsWith(".cs")
        ? /public\s+(?:sealed\s+)?(?:record|class)\s+([A-Z][A-Za-z0-9_]*)\s*[({]([^})]{10,2000})[})]/g
        : /export\s+(?:interface|type)\s+([A-Z][A-Za-z0-9_]*)\s*(?:=\s*)?\{([^}]{10,2000})\}/g;
  for (const m of text.matchAll(blockRe)) {
    const name = m[1];
    const body = m[2] ?? "";
    if (!name) continue;
    const fields = new Set<string>();
    for (const fm of body.matchAll(/(?:^|[;\n,])\s*(?:readonly\s+|pub\s+|public\s+\S+\s+)?([a-zA-Z_][a-zA-Z0-9_]{1,40})\s*\??\s*[:=]/g)) {
      const f = fm[1];
      if (f && !["readonly", "public", "private", "protected", "static", "type", "interface"].includes(f)) {
        fields.add(f.toLowerCase());
      }
    }
    if (fields.size >= 4) {
      shapes.push({ name, file: rel, line: lineAt(text, m.index ?? 0), unit, fields });
    }
  }
  return shapes;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const item of a) {
    if (b.has(item)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function loadRetiringConfig(rootDir: string): RetiringRule[] {
  for (const cand of [".repospec/retiring.json", "repospec.config.json"]) {
    const abs = path.join(rootDir, cand);
    if (!fs.existsSync(abs)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as {
        retiring?: RetiringRule[];
        retiringInterfaces?: RetiringRule[];
      };
      const list = parsed.retiring ?? parsed.retiringInterfaces;
      if (Array.isArray(list)) return list.filter((r) => typeof r?.path === "string" && r.path.trim().length > 0);
    } catch {
      continue;
    }
  }
  return [];
}

function scanSingleFile(params: {
  rel: string;
  unit: string;
  text: string;
  lines: string[];
  isTest: boolean;
  facts: FactRecord[];
  shapes: ExtractedShape[];
  extendsMap: Map<string, { parent: string; file: string; line: number; unit: string }>;
  unitLibs: Map<string, Map<string, { file: string; line: number }>>;
  retiring: readonly RetiringRule[];
}): void {
  const { rel, unit, text, lines, isTest, facts, shapes, extendsMap, unitLibs, retiring } = params;

  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i] ?? "";
    const trimmed = ln.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

    if (!isTest) {
      for (const sp of SOUNDINESS_PATTERNS) {
        if (sp.re.test(trimmed)) {
          facts.push({
            extractorId: EXTRACTOR_ID,
            kind: "soundiness",
            key: `${sp.category}:${rel}:${i + 1}`,
            file: rel,
            line: i + 1,
            unit,
            payload: { category: sp.category, detail: sp.detail },
          });
        }
      }

      if (!PERSISTENCE_PATH_RE.test(rel) && /^(?:export\s+|pub\s+|public\s+)/.test(trimmed)) {
        const leakMatch = trimmed.match(LEAKED_SECRET_TYPE_RE);
        if (leakMatch?.[1]) {
          facts.push({
            extractorId: EXTRACTOR_ID,
            kind: "secret_leak",
            key: `${rel}:${i + 1}:${leakMatch[1]}`,
            file: rel,
            line: i + 1,
            unit,
            symbol: leakMatch[1],
            severity: "warn",
            payload: { leakedType: leakMatch[1], snippet: trimmed.slice(0, 120) },
          });
        }
      }
    }

    if (retiring.length > 0) {
      const relSpecMatch = trimmed.match(/(?:from|import|require\s*\()\s*["']([^"']+)["']/);
      const spec = relSpecMatch?.[1] ?? "";
      const resolvedSpec = spec.startsWith(".")
        ? path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec))
        : spec.replace(/^\.\//, "");
      for (const rule of retiring) {
        const normRet = rule.path.replace(/^\.\//, "");
        const normRetNoExt = normRet.replace(/\.[a-z]+$/, "");
        const matched =
          resolvedSpec === normRet ||
          resolvedSpec === normRetNoExt ||
          `${resolvedSpec}.ts` === normRet ||
          trimmed.includes(`"${normRet}"`) ||
          trimmed.includes(`'${normRet}'`);
        if (matched && !(rule.allowExisting ?? []).includes(rel)) {
          facts.push({
            extractorId: EXTRACTOR_ID,
            kind: "retiring_interface_violation",
            key: `${rel}:${i + 1}:${normRet}`,
            file: rel,
            line: i + 1,
            unit,
            severity: "error",
            payload: { retiredPath: normRet, replacement: rule.replacement ?? "paved path" },
          });
        }
      }
    }

    const impPkg = trimmed.match(/(?:from\s+["']([^."'][^"']*)["']|require\s*\(\s*["']([^."'][^"']*)["']\s*\)|use\s+([a-z0-9_]+)::|import\s+([a-z0-9_]+)\b)/);
    const rawPkg = (impPkg?.[1] ?? impPkg?.[2] ?? impPkg?.[3] ?? impPkg?.[4] ?? "").split("/")[0] ?? "";
    if (!isTest && rawPkg) {
      const m = unitLibs.get(unit) ?? new Map<string, { file: string; line: number }>();
      if (!m.has(rawPkg)) m.set(rawPkg, { file: rel, line: i + 1 });
      unitLibs.set(unit, m);
    }

    const extMatch = trimmed.match(/\bclass\s+([A-Z][A-Za-z0-9_]*)\s+(?:extends|:)\s+([A-Z][A-Za-z0-9_]*)/);
    if (!isTest && extMatch?.[1] && extMatch?.[2] && !["Error", "EventEmitter", "Component", "ControllerBase", "DbContext", "BackgroundService"].includes(extMatch[2])) {
      extendsMap.set(extMatch[1], { parent: extMatch[2], file: rel, line: i + 1, unit });
    }
  }

  if (isTest) return;

  shapes.push(...extractExportedShapes(rel, unit, text));

  if (PROJECTION_PATH_RE.test(rel)) {
    const mutMatch = text.match(/\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|\.(?:save|update|delete|upsert|insert|commit|execute)\s*\()/i);
    if (mutMatch && mutMatch.index !== undefined) {
      facts.push({
        extractorId: EXTRACTOR_ID,
        kind: "projection_authority_leak",
        key: `${rel}:${lineAt(text, mutMatch.index)}`,
        file: rel,
        line: lineAt(text, mutMatch.index),
        unit,
        severity: "warn",
        payload: { token: mutMatch[0].slice(0, 48) },
      });
    }
  }

  for (const m of text.matchAll(/export\s+function\s+((?:to|from|map)[A-Z][A-Za-z0-9_]*(?:Dto|Row|Model|Record|Wire|Entity|View))\s*\([^)]*\)[^{]*\{([\s\S]{20,1200}?)\n\}/g)) {
    const fnName = m[1] ?? "";
    const body = m[2] ?? "";
    const fieldCopies = (body.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\s*:\s*[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*/g) ?? []).length;
    const hasBranch = /\b(?:if|switch|for|while)\s*\(/.test(body);
    if (fieldCopies >= 5 && !hasBranch) {
      facts.push({
        extractorId: EXTRACTOR_ID,
        kind: "format_adapter_glue",
        key: `${rel}:${fnName}`,
        file: rel,
        line: lineAt(text, m.index ?? 0),
        unit,
        symbol: fnName,
        severity: "info",
        payload: { fieldCopies },
      });
    }
  }

  for (const m of text.matchAll(/export\s+class\s+([A-Z][A-Za-z0-9_]*(?:Service|Adapter|Wrapper|Facade|Repository|Client))\s*\{([\s\S]{20,1400}?)\n\}/g)) {
    const clsName = m[1] ?? "";
    const body = m[2] ?? "";
    const delegateCalls = (body.match(/return\s+this\.[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*\s*\(/g) ?? []).length;
    const methods = (body.match(/^\s+(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(?!constructor\b)[a-zA-Z_][a-zA-Z0-9_]*\s*\(/gm) ?? []).length;
    const hasBranch = /\b(?:if|switch|for|while|try)\b/.test(body);
    if (methods >= 2 && delegateCalls >= methods && !hasBranch) {
      facts.push({
        extractorId: EXTRACTOR_ID,
        kind: "passthrough_wrapper",
        key: `${rel}:${clsName}`,
        file: rel,
        line: lineAt(text, m.index ?? 0),
        unit,
        symbol: clsName,
        severity: "warn",
        payload: { methods, delegateCalls },
      });
    }
  }
}

export const parnasUncomplectExtractor: ExtractorPlugin = {
  id: EXTRACTOR_ID,
  domain: "arch",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const facts: FactRecord[] = [];
    const sortedUnits = [...ctx.units].sort((a, b) => b.dir.length - a.dir.length);
    const retiring = loadRetiringConfig(ctx.rootDir);
    const shapes: ExtractedShape[] = [];
    const extendsMap = new Map<string, { parent: string; file: string; line: number; unit: string }>();
    const unitLibs = new Map<string, Map<string, { file: string; line: number }>>();

    for (const rel of ctx.allFiles) {
      if (!CODE_EXT_RE.test(rel) || rel.endsWith(".d.ts") || isExcludedCodePath(rel)) continue;
      const abs = path.join(ctx.rootDir, rel);
      let text = "";
      try {
        if (fs.statSync(abs).size > 300_000) continue;
        text = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const isTest = TEST_RE.test(rel);
      const unit = unitForFile(rel, sortedUnits, ctx.repoName);
      scanSingleFile({
        rel,
        unit,
        text,
        lines: text.split("\n"),
        isTest,
        facts,
        shapes,
        extendsMap,
        unitLibs,
        retiring,
      });
    }

    const cappedShapes = shapes.slice(0, 350);
    const seenDupPairs = new Set<string>();
    for (let i = 0; i < cappedShapes.length; i += 1) {
      const a = cappedShapes[i];
      if (!a) continue;
      for (let j = i + 1; j < cappedShapes.length; j += 1) {
        const b = cappedShapes[j];
        if (!b || a.file === b.file) continue;
        const sim = jaccardSimilarity(a.fields, b.fields);
        if (sim < 0.8) continue;
        const pairKey = [a.file + ":" + a.name, b.file + ":" + b.name].sort().join("<->");
        if (seenDupPairs.has(pairKey)) continue;
        seenDupPairs.add(pairKey);
        facts.push({
          extractorId: EXTRACTOR_ID,
          kind: "near_duplicate_type",
          key: pairKey,
          file: a.file,
          line: a.line,
          unit: a.unit,
          symbol: a.name,
          severity: "warn",
          payload: {
            typeA: a.name,
            fileA: a.file,
            typeB: b.name,
            fileB: b.file,
            jaccard: Math.round(sim * 100) / 100,
            sharedFields: a.fields.size,
          },
        });
      }
    }

    for (const [cls, info] of extendsMap) {
      let depth = 1;
      let cur = info.parent;
      const visited = new Set<string>([cls]);
      while (cur && !visited.has(cur)) {
        const nextInfo = extendsMap.get(cur);
        if (!nextInfo) break;
        visited.add(cur);
        depth += 1;
        cur = nextInfo.parent;
      }
      if (depth >= 3) {
        facts.push({
          extractorId: EXTRACTOR_ID,
          kind: "inheritance_smell",
          key: `${info.file}:${cls}`,
          file: info.file,
          line: info.line,
          unit: info.unit,
          symbol: cls,
          severity: "warn",
          payload: { depth, parent: info.parent },
        });
      }
    }

    for (const [unit, libMap] of unitLibs) {
      for (const group of COMPETING_CONCERN_GROUPS) {
        const found = group.libraries.filter((lib) => libMap.has(lib));
        const firstLib = found[0];
        const sample = firstLib ? libMap.get(firstLib) : undefined;
        if (found.length >= 2 && sample) {
          facts.push({
            extractorId: EXTRACTOR_ID,
            kind: "competing_library",
            key: `${unit}:${group.concern}`,
            file: sample.file,
            line: sample.line,
            unit,
            severity: "warn",
            payload: { concern: group.concern, libraries: found },
          });
        }
      }
    }

    const metrics: MetricRecord[] = [
      { extractorId: EXTRACTOR_ID, scopeKind: "repo", scopeId: "repo", name: "soundiness_approximations", valueNum: facts.filter((f) => f.kind === "soundiness").length },
      { extractorId: EXTRACTOR_ID, scopeKind: "repo", scopeId: "repo", name: "near_duplicate_types", valueNum: facts.filter((f) => f.kind === "near_duplicate_type").length },
    ];

    return { nodes: [], edges: [], rules: [], facts, metrics };
  },
};
