import fs from "node:fs";
import yaml from "js-yaml";
import ts from "typescript";
import type { ExtractorPlugin } from "../../../../src/schema.ts";
import { defineExtractor, type ScanToolkit } from "./toolkit.ts";

export interface DeclarativeFactSpec {
  readonly kind: string;
  readonly files?: string;
  readonly severity?: "info" | "warn" | "error";
  readonly match: {
    readonly call?: readonly string[];
    readonly import?: readonly string[];
    readonly hclBlock?: readonly string[];
    readonly yamlPath?: string;
    readonly regex?: string;
  };
  readonly extract?: {
    readonly key?: string;
    readonly payload?: Record<string, string>;
  };
}

export interface DeclarativeFactsFile {
  readonly facts: readonly DeclarativeFactSpec[];
}

function interpolateTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$([A-Za-z0-9_]+)/g, (_, name: string) => vars[name] ?? "");
}

function resolvePayload(
  specPayload: Record<string, string> | undefined,
  vars: Record<string, string>,
): Record<string, unknown> {
  if (!specPayload) return { ...vars };
  const out: Record<string, unknown> = {};
  for (const [k, tmpl] of Object.entries(specPayload)) {
    out[k] = interpolateTemplate(tmpl, vars);
  }
  return out;
}

function stringLiteralText(node: ts.Expression | undefined): string {
  if (!node) return "";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return node.getText();
}

function calleeName(expr: ts.LeftHandSideExpression): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return expr.getText();
}

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function runCallMatcher(kit: ScanToolkit, spec: DeclarativeFactSpec, file: string): void {
  const names = new Set(spec.match.call ?? []);
  if (names.size === 0) return;
  const sf = kit.tsSourceFile(file);
  if (!sf) return;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const fullCallee = node.expression.getText(sf);
      const shortCallee = calleeName(node.expression);
      if (names.has(fullCallee) || names.has(shortCallee)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        const vars: Record<string, string> = {
          callee: fullCallee,
          shortCallee,
          arg0: stringLiteralText(node.arguments[0]),
          arg1: stringLiteralText(node.arguments[1]),
          arg2: stringLiteralText(node.arguments[2]),
          file,
        };
        const key = spec.extract?.key ? interpolateTemplate(spec.extract.key, vars) : vars.arg0 || fullCallee;
        kit.emitFact({
          kind: spec.kind,
          key: key || fullCallee,
          file,
          line,
          symbol: shortCallee,
          severity: spec.severity,
          payload: resolvePayload(spec.extract?.payload, vars),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function runImportMatcher(kit: ScanToolkit, spec: DeclarativeFactSpec, file: string): void {
  const targets = spec.match.import ?? [];
  if (targets.length === 0) return;
  const sf = kit.tsSourceFile(file);
  if (!sf) return;

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const pkg = stmt.moduleSpecifier.text;
    const hit = targets.some((t) => pkg === t || pkg.startsWith(`${t}/`));
    if (!hit) continue;
    const line = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1;
    const vars = { pkg, specifier: pkg, file };
    const key = spec.extract?.key ? interpolateTemplate(spec.extract.key, vars) : pkg;
    kit.emitFact({
      kind: spec.kind,
      key: key || pkg,
      file,
      line,
      severity: spec.severity,
      payload: resolvePayload(spec.extract?.payload, vars),
    });
  }
}

function runHclBlockMatcher(kit: ScanToolkit, spec: DeclarativeFactSpec, file: string): void {
  const blockTypes = new Set((spec.match.hclBlock ?? []).map((b) => b.toLowerCase()));
  if (blockTypes.size === 0) return;
  const text = kit.readText(file);
  if (!text) return;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = (lines[i] ?? "").trim();
    const m = trimmed.match(/^(resource|data|check|module|locals)\s*(?:"([^"]+)")?\s*(?:"([^"]+)")?/);
    if (!m) continue;
    const blockType = (m[1] ?? "").toLowerCase();
    if (!blockTypes.has(blockType)) continue;
    const typeName = m[2] ?? "";
    const name = m[3] ?? typeName;
    const vars = { blockType, type: typeName, name, file };
    const defaultKey = typeName && name && typeName !== name ? `${typeName}.${name}` : name || blockType;
    const key = spec.extract?.key ? interpolateTemplate(spec.extract.key, vars) : defaultKey;
    kit.emitFact({
      kind: spec.kind,
      key: key || defaultKey,
      file,
      line: i + 1,
      severity: spec.severity,
      payload: resolvePayload(spec.extract?.payload, vars),
    });
  }
}

function runYamlPathMatcher(kit: ScanToolkit, spec: DeclarativeFactSpec, file: string): void {
  const yPath = spec.match.yamlPath;
  if (!yPath) return;
  const text = kit.readText(file);
  if (!text) return;
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch {
    return;
  }
  const segs = yPath.split(".").filter(Boolean);
  let cur: unknown = parsed;
  for (const seg of segs) {
    if (cur && typeof cur === "object" && seg in cur) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return;
    }
  }
  if (cur === undefined || cur === null) return;
  const valStr = typeof cur === "string" || typeof cur === "number" || typeof cur === "boolean" ? String(cur) : JSON.stringify(cur);
  const vars = { path: yPath, value: valStr, file };
  const key = spec.extract?.key ? interpolateTemplate(spec.extract.key, vars) : valStr;
  kit.emitFact({
    kind: spec.kind,
    key: key || yPath,
    file,
    line: 1,
    severity: spec.severity,
    payload: resolvePayload(spec.extract?.payload, vars),
  });
}

function runRegexMatcher(kit: ScanToolkit, spec: DeclarativeFactSpec, file: string): void {
  const pattern = spec.match.regex;
  if (!pattern) return;
  const text = kit.readText(file);
  if (!text) return;
  let re: RegExp;
  try {
    re = new RegExp(pattern, "gm");
  } catch (err) {
    kit.emitDiagnostic({
      code: "facts.invalid-regex",
      severity: "warn",
      message: `Invalid regex in fact '${spec.kind}': ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }
  let match: RegExpExecArray | null = re.exec(text);
  while (match !== null) {
    const vars: Record<string, string> = { file, "0": match[0] ?? "" };
    for (let i = 1; i < match.length; i += 1) {
      vars[String(i)] = match[i] ?? "";
    }
    const line = lineNumberAt(text, match.index);
    const key = spec.extract?.key ? interpolateTemplate(spec.extract.key, vars) : vars["1"] || vars["0"];
    kit.emitFact({
      kind: spec.kind,
      key: key || spec.kind,
      file,
      line,
      severity: spec.severity,
      payload: resolvePayload(spec.extract?.payload, vars),
    });
    if (match[0] === "") re.lastIndex += 1;
    match = re.exec(text);
  }
}

export function buildDeclarativeFactsExtractor(
  specs: readonly DeclarativeFactSpec[],
  extractorId = "declarative.facts.v1",
): ExtractorPlugin {
  return defineExtractor({
    id: extractorId,
    domain: "arch",
    extract(kit) {
      for (const spec of specs) {
        if (!spec.kind) continue;
        const matchedFiles = kit.files(spec.files ?? "**/*");
        for (const file of matchedFiles) {
          if (spec.match.call) runCallMatcher(kit, spec, file);
          if (spec.match.import) runImportMatcher(kit, spec, file);
          if (spec.match.hclBlock) runHclBlockMatcher(kit, spec, file);
          if (spec.match.yamlPath) runYamlPathMatcher(kit, spec, file);
          if (spec.match.regex) runRegexMatcher(kit, spec, file);
        }
      }
    },
  });
}

export function loadDeclarativeFactsExtractor(absPath: string): ExtractorPlugin | null {
  if (!fs.existsSync(absPath)) return null;
  const raw = fs.readFileSync(absPath, "utf8");
  const parsed = absPath.endsWith(".json") ? JSON.parse(raw) : yaml.load(raw);
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as DeclarativeFactsFile).facts)) {
    return null;
  }
  const specs = (parsed as DeclarativeFactsFile).facts;
  if (specs.length === 0) return null;
  return buildDeclarativeFactsExtractor(specs, "declarative.facts.v1");
}
