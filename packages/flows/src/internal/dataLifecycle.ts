import ts from "typescript";
import type {
  EntityFieldLifecycle,
  EntityFieldReader,
  EntityFieldWriter,
  ExtractedStateMachine,
  ExtractedStateTransition,
  FlowHazard,
} from "./types.ts";

const TEST_FILE_RE = /(?:__tests__|\.test\.|\.spec\.|\/tests?\/|fixtures\/|canary\/emulator)/i;
const UI_FILE_RE = /\.(?:tsx|jsx)$/i;
const MUTATION_CALL_RE =
  /(?:^|\.)(commit\w*Document|update\w*|set\w*|patch\w*|save\w*|upsert\w*|write\w*)$/i;
const EXPLICIT_BARE_MUTATION_RE = /^(?:commit\w*Document|upsert\w*|write\w*Doc\w*|save\w*Doc\w*|update\w*Doc\w*)$/i;
const NON_DB_RECEIVER_RE =
  /^(?:res|req|headers|params|searchParams|url|map|set|cache|cookies|localStorage|sessionStorage|window|document|style|form|queryClient|router|navigator|console|process|env)\./i;
const WRITE_OPTION_KEYS = new Set([
  "merge",
  "mergeFields",
  "ignoreUndefinedProperties",
  "retry",
  "timeout",
  "timeoutMs",
  "signal",
  "headers",
  "method",
  "credentials",
  "cache",
  "mode",
]);
const DERIVE_FN_RE = /^(?:derive|compute|response|resolve|overlay|project|calculate)[A-Z]/;

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function propKeyText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

function stringLiteralArray(expr: ts.Expression): string[] {
  if (!ts.isArrayLiteralExpression(expr)) return [];
  const out: string[] = [];
  for (const el of expr.elements) {
    if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) {
      out.push(el.text);
    }
  }
  return out;
}

function inferEntityName(relFile: string, callText: string): string {
  const m = callText.match(/(?:device|cartridge|property|company|user|order|shipment|session|capture|measurement)/i);
  if (m?.[0]) return `${m[0].toLowerCase()}s`;
  const seg = relFile.split("/").slice(-2, -1)[0] ?? "entity";
  return seg.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "entity";
}

function enclosingFnName(node: ts.Node): string {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    cur = cur.parent;
  }
  return "module";
}

export interface RawFieldEvent {
  entity: string;
  field: string;
  kind: "writer" | "reader";
  fn: string;
  file: string;
  line: number;
  mode: "write" | "delete" | "tx";
  derived: boolean;
}

export function extractFieldEventsFromSource(
  sf: ts.SourceFile,
  relFile: string,
): RawFieldEvent[] {
  if (TEST_FILE_RE.test(relFile) || UI_FILE_RE.test(relFile)) return [];
  const events: RawFieldEvent[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const exprText = node.expression.getText(sf);
      const hasReceiver = exprText.includes(".");
      const isDbMutation =
        MUTATION_CALL_RE.test(exprText) &&
        !NON_DB_RECEIVER_RE.test(exprText) &&
        (hasReceiver || EXPLICIT_BARE_MUTATION_RE.test(exprText));
      if (isDbMutation) {
        const entity = inferEntityName(relFile, exprText);
        const fn = enclosingFnName(node);
        const isTx = /commit|transaction/i.test(exprText);
        for (const arg of node.arguments) {
          if (!ts.isObjectLiteralExpression(arg)) continue;
          const propKeys: string[] = [];
          for (const prop of arg.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const k = propKeyText(prop.name);
            if (k) propKeys.push(k);
          }
          if (propKeys.length > 0 && propKeys.every((k) => WRITE_OPTION_KEYS.has(k))) continue;
          for (const prop of arg.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const field = propKeyText(prop.name);
            if (!field || field.length > 48 || WRITE_OPTION_KEYS.has(field)) continue;
            const valText = prop.initializer.getText(sf);
            const isDelete = /FieldValue\.delete\(\)|deleteField\(\)/.test(valText);
            events.push({
              entity,
              field,
              kind: "writer",
              fn,
              file: relFile,
              line: lineOf(sf, prop),
              mode: isDelete ? "delete" : isTx ? "tx" : "write",
              derived: false,
            });
          }
        }
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name && DERIVE_FN_RE.test(node.name.text)) {
      const fnName = node.name.text;
      const entity = inferEntityName(relFile, fnName);
      const bodyText = node.body ? node.body.getText(sf) : "";
      const seen = new Set<string>();
      for (const m of bodyText.matchAll(/\b(?:device|doc|record|facts|status)\.([a-zA-Z0-9_.]{2,36})/g)) {
        const field = m[1];
        if (!field || seen.has(field)) continue;
        seen.add(field);
        events.push({
          entity,
          field,
          kind: "reader",
          fn: fnName,
          file: relFile,
          line: lineOf(sf, node),
          mode: "write",
          derived: true,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return events;
}

export function buildEntityLifecycles(
  rawEvents: readonly RawFieldEvent[],
): { lifecycles: EntityFieldLifecycle[]; hazards: FlowHazard[] } {
  const byKey = new Map<string, { entity: string; field: string; writers: EntityFieldWriter[]; readers: EntityFieldReader[] }>();

  for (const ev of rawEvents) {
    const key = `${ev.entity}::${ev.field}`;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { entity: ev.entity, field: ev.field, writers: [], readers: [] };
      byKey.set(key, bucket);
    }
    if (ev.kind === "writer") {
      if (!bucket.writers.some((w) => w.file === ev.file && w.fn === ev.fn && w.line === ev.line)) {
        bucket.writers.push({ fn: ev.fn, file: ev.file, line: ev.line, mode: ev.mode });
      }
    } else if (!bucket.readers.some((r) => r.file === ev.file && r.fn === ev.fn)) {
      bucket.readers.push({ fn: ev.fn, file: ev.file, line: ev.line, derived: ev.derived });
    }
  }

  const lifecycles: EntityFieldLifecycle[] = [];
  const hazards: FlowHazard[] = [];

  for (const entry of byKey.values()) {
    const distinctFiles = new Set(entry.writers.filter((w) => w.mode !== "delete").map((w) => w.file));
    const hasTxOnly = entry.writers.length > 0 && entry.writers.every((w) => w.mode === "tx" || w.mode === "delete");
    const derivedOnRead = entry.readers.some((r) => r.derived);
    const multiWriterRisk = distinctFiles.size >= 3 && !hasTxOnly;

    if (entry.writers.length + entry.readers.length < 2) continue;

    lifecycles.push({
      entity: entry.entity,
      field: entry.field,
      writers: entry.writers.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line).slice(0, 12),
      readers: entry.readers.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line).slice(0, 12),
      derivedOnRead,
      multiWriterRisk,
    });

    if (multiWriterRisk) {
      const first = entry.writers[0];
      if (first) {
        hazards.push({
          kind: "multi_writer_unowned_field",
          severity: "warn",
          file: first.file,
          line: first.line,
          subject: `${entry.entity}.${entry.field} (${distinctFiles.size} writer files)`,
          summary: `Field ${entry.entity}.${entry.field} is mutated from ${distinctFiles.size} separate files without a single transactional owner.`,
          stepIndexes: [],
        });
      }
    }
  }

  lifecycles.sort(
    (a, b) =>
      Number(b.multiWriterRisk) - Number(a.multiWriterRisk) ||
      b.writers.length - a.writers.length ||
      `${a.entity}.${a.field}`.localeCompare(`${b.entity}.${b.field}`),
  );

  return { lifecycles: lifecycles.slice(0, 60), hazards };
}

function extractGuardMap(sf: ts.SourceFile): Map<string, string> {
  const guards = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /GUARD/i.test(node.name.text) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isObjectLiteralExpression(prop.initializer)) continue;
        const fromKey = propKeyText(prop.name);
        if (!fromKey) continue;
        for (const inner of prop.initializer.properties) {
          if (!ts.isPropertyAssignment(inner)) continue;
          const toKey = propKeyText(inner.name);
          const req = stringLiteralArray(inner.initializer);
          if (toKey && req.length > 0) {
            guards.set(`${fromKey}->${toKey}`, req.join("+"));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return guards;
}

function extractPhaseConstants(sf: ts.SourceFile): { name: string; phases: Map<string, string>; line: number } | null {
  let found: { name: string; phases: Map<string, string>; line: number } | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /(?:Phase|Stage|Status|State)s?$/.test(node.name.text) &&
      node.initializer
    ) {
      let obj: ts.Expression = node.initializer;
      while (ts.isAsExpression(obj) || ts.isSatisfiesExpression(obj)) {
        obj = obj.expression;
      }
      if (ts.isObjectLiteralExpression(obj)) {
        const phases = new Map<string, string>();
        for (const prop of obj.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const k = propKeyText(prop.name);
          if (k && (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer))) {
            phases.set(`${node.name.text}.${k}`, prop.initializer.text);
          }
        }
        if (phases.size >= 3) {
          found = { name: node.name.text, phases, line: lineOf(sf, node) };
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export function extractStateMachinesFromSource(
  sf: ts.SourceFile,
  relFile: string,
  unitSlug: string,
): ExtractedStateMachine[] {
  if (TEST_FILE_RE.test(relFile)) return [];
  const machines: ExtractedStateMachine[] = [];
  const guardMap = extractGuardMap(sf);

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /TRANSITIONS/i.test(node.name.text) &&
      node.initializer
    ) {
      let obj: ts.Expression = node.initializer;
      while (ts.isAsExpression(obj) || ts.isSatisfiesExpression(obj)) {
        obj = obj.expression;
      }
      if (ts.isObjectLiteralExpression(obj)) {
        const states = new Set<string>();
        const transitions: ExtractedStateTransition[] = [];
        for (const prop of obj.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const from = propKeyText(prop.name);
          if (!from) continue;
          states.add(from);
          for (const to of stringLiteralArray(prop.initializer)) {
            states.add(to);
            const guard = guardMap.get(`${from}->${to}`);
            const tr: ExtractedStateTransition = { from, to, event: `to_${to}` };
            if (guard) tr.guard = guard;
            transitions.push(tr);
          }
        }
        if (states.size >= 3 && transitions.length >= 2) {
          const baseName = relFile.split("/").pop()?.replace(/\.[^.]+$/, "") ?? node.name.text;
          machines.push({
            id: `sm:${unitSlug}:${baseName}`,
            name: baseName,
            file: relFile,
            line: lineOf(sf, node),
            unit: unitSlug,
            states: Array.from(states),
            transitions,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (machines.length === 0) {
    const phaseConst = extractPhaseConstants(sf);
    if (phaseConst) {
      const fullText = sf.getText();
      const events = Array.from(
        new Set(
          Array.from(fullText.matchAll(/case\s+["']([a-zA-Z0-9_-]+)["']\s*:/g))
            .map((m) => m[1])
            .filter((x): x is string => Boolean(x)),
        ),
      );
      const transitions: ExtractedStateTransition[] = [];
      const phaseList = Array.from(phaseConst.phases.values());
      const initial = phaseList[0] ?? "pending";
      const phaseByPrefix = new Map<string, string>();
      const seenTargets = new Set<string>();
      for (const p of phaseList) {
        if (p !== initial) {
          phaseByPrefix.set(p.slice(0, 4).toLowerCase(), p);
        }
      }
      for (const ev of events) {
        const matchedTarget = phaseByPrefix.get(ev.slice(0, 4).toLowerCase());
        if (matchedTarget) {
          transitions.push({ from: initial, to: matchedTarget, event: ev });
          seenTargets.add(matchedTarget);
        }
      }
      for (const m of fullText.matchAll(/phase:\s*([A-Za-z0-9_]+\.[A-Za-z0-9_]+)/g)) {
        const ref = m[1];
        const target = ref ? phaseConst.phases.get(ref) : undefined;
        if (target && target !== initial && !seenTargets.has(target)) {
          transitions.push({ from: initial, to: target, event: `enter_${target}` });
          seenTargets.add(target);
        }
      }
      if (transitions.length >= 2) {
        const baseName = relFile.split("/").pop()?.replace(/\.[^.]+$/, "") ?? phaseConst.name;
        machines.push({
          id: `sm:${unitSlug}:${baseName}`,
          name: baseName,
          file: relFile,
          line: phaseConst.line,
          unit: unitSlug,
          states: phaseList,
          transitions,
        });
      }
    }
  }

  return machines;
}
