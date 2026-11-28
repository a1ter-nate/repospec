import fs from "node:fs";
import path from "node:path";
import type { RepoContext, Rung, SpecNode, SpecRule } from "@repospec/plugin";

export interface RungPathOverride {
  pattern: string;
  rung: Rung;
  tier: string;
}

const VALID_RUNGS = new Set<Rung>(["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"]);

const RUNG_DEFAULT_TIER: Record<Rung, string> = {
  R0: "static_lint",
  R1: "type_arch",
  R2: "unit_pure",
  R3: "component_contract",
  R4: "integration",
  R5: "mutation_fuzz",
  R6: "load_perf",
  R7: "e2e",
  R8: "formal_proof",
};

function readTextSafe(absPath: string): string | null {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

function normalizeRung(raw: string): Rung | null {
  const up = raw.trim().toUpperCase();
  return VALID_RUNGS.has(up as Rung) ? (up as Rung) : null;
}

function inferRungFromName(name: string): Rung {
  const lower = name.toLowerCase();
  const explicit = lower.match(/\b(r[0-8])\b/);
  if (explicit?.[1]) {
    const r = normalizeRung(explicit[1]);
    if (r) return r;
  }
  if (lower.includes("comment") || lower.includes("explicit-any") || lower.includes("suppression") || lower.includes("lint")) {
    return "R0";
  }
  if (lower.includes("e2e") || lower.includes("playwright")) return "R7";
  if (lower.includes("perf") || lower.includes("load") || lower.includes("bench")) return "R6";
  if (lower.includes("stryker") || lower.includes("mutat") || lower.includes("fuzz")) return "R5";
  if (lower.includes("integration") || lower.includes("migrat")) return "R4";
  if (lower.includes("contract") || lower.includes("mbt") || lower.includes("component")) return "R3";
  if (lower.includes("floor") || lower.includes("property") || lower.includes("determinism") || lower.includes("unit")) {
    return "R2";
  }
  return "R1";
}

function extractCommandTestTargets(command: string): string[] {
  const out: string[] = [];
  const tokens = command.split(/\s+/);
  for (const rawTok of tokens) {
    const tok = rawTok.replace(/^["']|["']$/g, "").replace(/^\.\//, "").replace(/\/+$/, "");
    if (!tok || tok.startsWith("-") || tok.includes("://")) continue;
    const isSpecificTestPath =
      /\.(?:test|spec)\.[a-z0-9]+$/i.test(tok) ||
      /(?:^|\/)(?:tests?|__tests__|e2e|integration|perf|load|bench|fuzz|mbt)\b/i.test(tok) ||
      /Tests?(?:\/|$)/i.test(tok);
    if (isSpecificTestPath && tok !== "tests" && tok !== "test") {
      out.push(tok);
    }
  }
  return out;
}

interface ParsedRungEntry {
  rung: Rung;
  name: string;
  command: string;
  required: boolean;
  explicitPaths: string[];
}

function collectRungPaths(obj: Record<string, unknown>): string[] {
  const acc: string[] = [];
  for (const key of ["paths", "testPaths", "patterns", "targets", "globs"]) {
    const val = obj[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string" && item.trim()) {
          acc.push(item.trim().replace(/^\.\//, "").replace(/\/+$/, ""));
        }
      }
    }
  }
  return acc;
}

function parseRungsJsonEntries(rawText: string): ParsedRungEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const root = parsed as Record<string, unknown>;
  const rungsVal = root.rungs ?? parsed;
  const out: ParsedRungEntry[] = [];

  if (Array.isArray(rungsVal)) {
    for (const entry of rungsVal) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const rung = normalizeRung(String(rec.rung ?? rec.id ?? ""));
      const command = typeof rec.command === "string" ? rec.command.trim() : "";
      if (!rung || !command) continue;
      out.push({
        rung,
        name: typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : `rung-${rung.toLowerCase()}`,
        command,
        required: rec.required !== false,
        explicitPaths: collectRungPaths(rec),
      });
    }
  } else if (rungsVal && typeof rungsVal === "object") {
    for (const [key, val] of Object.entries(rungsVal as Record<string, unknown>)) {
      const rung = normalizeRung(key);
      if (!rung || !val || typeof val !== "object") continue;
      const rec = val as Record<string, unknown>;
      const command = typeof rec.command === "string" ? rec.command.trim() : "";
      if (!command) continue;
      out.push({
        rung,
        name: typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : `rung-${rung.toLowerCase()}`,
        command,
        required: rec.required !== false,
        explicitPaths: collectRungPaths(rec),
      });
    }
  }

  return out;
}

export function extractQualityGatesAndRungs(ctx: RepoContext): {
  nodes: SpecNode[];
  rules: SpecRule[];
  rungOverrides: RungPathOverride[];
} {
  const nodes: SpecNode[] = [];
  const rules: SpecRule[] = [];
  const rungOverrides: RungPathOverride[] = [];
  const registeredNames = new Set<string>();
  const registeredCommands = new Set<string>();

  const pushGate = (params: {
    gateName: string;
    rung: Rung;
    scriptPath: string | null;
    commandHint: string;
    sourceFile: string;
    extraTags?: string[];
  }): void => {
    if (registeredNames.has(params.gateName)) return;
    registeredNames.add(params.gateName);
    if (params.commandHint) registeredCommands.add(params.commandHint.trim());
    const gateId = `rule:gate:${params.gateName}`;
    nodes.push({
      id: gateId,
      domain: "rules",
      kind: "quality_gate",
      label: params.gateName,
      group: "quality_gate",
      provenance: { file: params.sourceFile },
      tags: [params.rung, "gate", ...(params.extraTags ?? [])],
      meta: {
        gateName: params.gateName,
        rung: params.rung,
        scriptPath: params.scriptPath,
        commandHint: params.commandHint.slice(0, 240),
        sourceFile: params.sourceFile,
      },
    });
    rules.push({
      id: gateId,
      name: params.gateName,
      category: "quality_gate",
      enforcement: "ci_gate",
      rung: params.rung,
      statement: `Registered quality gate "${params.gateName}" enforced via ${params.sourceFile}`,
      targets: [],
      provenance: { file: params.sourceFile },
    });
  };

  for (const manifestRel of ["tools/verify-gates.ts", "tools/verify-gates.mjs"]) {
    const verifyGatesText = readTextSafe(path.join(ctx.rootDir, manifestRel));
    if (!verifyGatesText) continue;
    const gatesMatch = verifyGatesText.match(/export\s+const\s+GATES\s*(?::[^=]+)?=\s*\[([\s\S]*?)\n\];/);
    if (!gatesMatch?.[1]) continue;
    const block = gatesMatch[1];
    const entryRegex = /\{\s*name:\s*["']([^"']+)["'][\s\S]*?command:\s*([^\n}]+)/g;
    let match: RegExpExecArray | null = entryRegex.exec(block);
    while (match !== null) {
      const gateName = match[1];
      const cmdRaw = (match[2] ?? "").trim();
      const scriptMatch = cmdRaw.match(/["']([^"']+\.(?:ts|tsx|mjs|js|sh|py))["']/);
      if (gateName) {
        pushGate({
          gateName,
          rung: inferRungFromName(gateName),
          scriptPath: scriptMatch?.[1] ?? null,
          commandHint: cmdRaw,
          sourceFile: manifestRel,
        });
      }
      match = entryRegex.exec(block);
    }
  }

  const rungsRel = ".verification/rungs.json";
  const rungsText = readTextSafe(path.join(ctx.rootDir, rungsRel));
  if (rungsText) {
    for (const entry of parseRungsJsonEntries(rungsText)) {
      const tier = RUNG_DEFAULT_TIER[entry.rung];
      const patterns = entry.explicitPaths.length > 0 ? entry.explicitPaths : extractCommandTestTargets(entry.command);
      for (const pat of patterns) {
        rungOverrides.push({ pattern: pat, rung: entry.rung, tier });
      }
      if (!entry.required) continue;
      const scriptMatch = entry.command.match(/(?:^|\s)([A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|js|sh|py))\b/);
      pushGate({
        gateName: entry.name,
        rung: entry.rung,
        scriptPath: scriptMatch?.[1]?.replace(/^\.\//, "") ?? null,
        commandHint: entry.command,
        sourceFile: rungsRel,
        extraTags: ["verification-rung"],
      });
    }
  }

  const rootPkgText = readTextSafe(path.join(ctx.rootDir, "package.json"));
  if (rootPkgText) {
    try {
      const parsed = JSON.parse(rootPkgText) as { scripts?: Record<string, string> };
      const scripts = parsed.scripts ?? {};
      const verifyEntries = Object.entries(scripts)
        .filter(([name, cmd]) => /^verify:[a-z0-9_.:-]+$/i.test(name) && typeof cmd === "string" && cmd.trim().length > 0)
        .sort(([a], [b]) => a.localeCompare(b));
      for (const [scriptName, cmd] of verifyEntries) {
        const trimmed = cmd.trim();
        if (registeredCommands.has(trimmed)) continue;
        const scriptMatch = trimmed.match(/(?:^|\s)([A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|js|sh|py))\b/);
        pushGate({
          gateName: scriptName,
          rung: inferRungFromName(scriptName),
          scriptPath: scriptMatch?.[1]?.replace(/^\.\//, "") ?? null,
          commandHint: trimmed,
          sourceFile: "package.json",
          extraTags: ["npm-script"],
        });
      }
    } catch {
      void 0;
    }
  }

  rungOverrides.sort((a, b) => b.pattern.length - a.pattern.length || b.rung.localeCompare(a.rung));
  return { nodes, rules, rungOverrides };
}
