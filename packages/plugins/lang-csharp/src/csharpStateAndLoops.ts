import type { AstIndexData, LoopRecord, StateMachineRecord } from "@repospec/plugin";
import { lineOf } from "./csharpHelpers.ts";

export interface CsharpDeclaredStateType {
  name: string;
  unitName: string;
  file: string;
  line: number;
  states: string[];
  kind: "enum" | "record";
}

export function extractBalancedBlock(text: string, openBraceIdx: number): string {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openBraceIdx; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (inStr) {
      if (ch === "\\" && inStr !== '@"') {
        i += 1;
        continue;
      }
      if (inStr === '@"' && ch === '"' && text[i + 1] === '"') {
        i += 1;
        continue;
      }
      if (ch === '"' && (inStr === '"' || inStr === '@"')) inStr = null;
      else if (ch === "'" && inStr === "'") inStr = null;
      continue;
    }
    if (ch === "@" && text[i + 1] === '"') {
      inStr = '@"';
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(openBraceIdx + 1, i);
    }
  }
  return text.slice(openBraceIdx + 1);
}

export function extractCsharpLoops(rel: string, text: string, unitName: string, loops: LoopRecord[]): void {
  for (const m of text.matchAll(
    /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\([^)]*\))?\s*:[^{]*\b(BackgroundService|IHostedService|IJob)\b/g,
  )) {
    const cls = m[1];
    const kindToken = m[2];
    if (!cls) continue;
    loops.push({
      id: `arch:loop:csharp:${unitName}:${cls}`,
      name: cls,
      kind: kindToken === "IJob" ? "scheduler" : "background_service",
      schedule: null,
      unit: unitName,
      provenance: { file: rel, line: lineOf(text, m.index ?? 0) },
    });
  }
  for (const m of text.matchAll(/RecurringJob\.AddOrUpdate(?:<[^>]+>)?\s*\(\s*"([^"]+)"/g)) {
    const jobName = m[1];
    if (!jobName) continue;
    loops.push({
      id: `arch:loop:csharp:${unitName}:hangfire:${jobName}`,
      name: jobName,
      kind: "scheduler",
      schedule: null,
      unit: unitName,
      provenance: { file: rel, line: lineOf(text, m.index ?? 0) },
    });
  }
}

export function collectCsharpDeclaredStateTypes(
  rel: string,
  text: string,
  unitName: string,
): CsharpDeclaredStateType[] {
  const out: CsharpDeclaredStateType[] = [];
  const sealedByBase = new Map<string, string[]>();
  for (const vm of text.matchAll(/sealed\s+record\s+(?:class\s+|struct\s+)?([A-Za-z0-9_]+)(?:\([^)]*\))?\s*:\s*([A-Za-z0-9_]+)\b/g)) {
    const variant = vm[1];
    const base = vm[2];
    if (variant && base) {
      const list = sealedByBase.get(base) ?? [];
      list.push(variant);
      sealedByBase.set(base, list);
    }
  }

  for (const m of text.matchAll(/(?:public|internal)\s+abstract\s+record\s+(?:class\s+)?([A-Za-z0-9_]+)/g)) {
    const baseName = m[1];
    if (!baseName) continue;
    const variants = Array.from(new Set(sealedByBase.get(baseName) ?? [])).sort();
    if (variants.length >= 2 && /(?:State|Status|Phase|Stage)$/i.test(baseName)) {
      out.push({
        name: baseName,
        unitName,
        file: rel,
        line: lineOf(text, m.index ?? 0),
        states: variants,
        kind: "record",
      });
    }
  }

  for (const m of text.matchAll(
    /(?:(?:public|internal|private|protected|file)\s+)?enum\s+([A-Z][A-Za-z0-9_]*(?:State|Status|Phase|Stage))\s*(?::\s*[A-Za-z0-9_]+\s*)?\{/g,
  )) {
    const enumName = m[1];
    if (!enumName || m.index === undefined) continue;
    const body = extractBalancedBlock(text, m.index + m[0].length - 1);
    const vals = Array.from(
      new Set(
        body
          .split(",")
          .map((seg) => seg.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\[[^\]]+\]/g, "").trim().match(/^([A-Z][A-Za-z0-9_]*)/)?.[1])
          .filter((s): s is string => Boolean(s)),
      ),
    ).sort();
    if (vals.length >= 2) {
      out.push({
        name: enumName,
        unitName,
        file: rel,
        line: lineOf(text, m.index),
        states: vals,
        kind: "enum",
      });
    }
  }
  return out;
}

export function resolveCsharpStateMachines(
  declared: readonly CsharpDeclaredStateType[],
  unitTexts: ReadonlyMap<string, string[]>,
  ast: AstIndexData,
  stateMachines: StateMachineRecord[],
): void {
  for (const decl of declared) {
    const corpus = (unitTexts.get(decl.unitName) ?? []).join("\n");
    const safeName = decl.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const transitions: Array<{ from: string; event: string; to: string; guard?: string }> = [];
    const seen = new Set<string>();
    const pushTr = (from: string, event: string, to: string, guard?: string): void => {
      if (!from || !to) return;
      const key = `${from}->${to}:${event}`;
      if (seen.has(key)) return;
      seen.add(key);
      transitions.push(guard ? { from, event, to, guard } : { from, event, to });
    };

    if (decl.kind === "record") {
      const recRe = new RegExp(
        `\\(\\s*${safeName}\\.(\\w+)(?:\\s+\\w+)?\\s*,\\s*\\w+\\.(\\w+)(?:\\s+\\w+)?\\s*\\)(?:\\s+when\\s+([^=]+?))?\\s*=>[\\s\\S]{0,200}?(?:Accepted\\(\\s*)?new\\s+${safeName}\\.(\\w+)`,
        "g",
      );
      for (const tm of corpus.matchAll(recRe)) {
        if (tm[1] && tm[2] && tm[4]) pushTr(tm[1], tm[2], tm[4], tm[3]?.trim() || undefined);
      }
    } else {
      const exprRe = new RegExp(
        `\\(?\\s*${safeName}\\.([A-Z][A-Za-z0-9_]*)(?:\\s*,\\s*(?:\\w+\\.)?"?([A-Za-z0-9_.-]+)"?)?\\s*\\)?(?:\\s+when\\s+([^=>\\n]+))?\\s*=>[\\s\\S]{0,120}?${safeName}\\.([A-Z][A-Za-z0-9_]*)`,
        "g",
      );
      for (const am of corpus.matchAll(exprRe)) {
        if (am[1] && am[4]) pushTr(am[1], am[2] ?? `to_${am[4]}`, am[4], am[3]?.trim() || undefined);
      }
      const caseRe = new RegExp(
        `case\\s+${safeName}\\.([A-Z][A-Za-z0-9_]*)\\s*:[\\s\\S]{0,220}?(?:return|=)\\s*${safeName}\\.([A-Z][A-Za-z0-9_]*)`,
        "g",
      );
      for (const cm of corpus.matchAll(caseRe)) {
        if (cm[1] && cm[2] && cm[1] !== cm[2]) pushTr(cm[1], `to_${cm[2]}`, cm[2]);
      }
    }

    if (transitions.length > 0) {
      stateMachines.push({
        id: `arch:sm:csharp:${decl.unitName}:${decl.name}`,
        name: decl.name,
        language: "csharp",
        unit: decl.unitName,
        evidence: "declared",
        states: decl.states,
        transitions,
        provenance: { file: decl.file, line: decl.line },
      });
    }

    ast.stateEnums.push({
      file: decl.file,
      unit: decl.unitName,
      language: "csharp",
      name: decl.name,
      valuesSignature: decl.states.join("|"),
      values: decl.states,
      line: decl.line,
      hasTransitions: transitions.length > 0,
    });
  }
}
