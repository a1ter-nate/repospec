import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { SpecDiagnostic } from "../../schema.ts";

interface DomainsJson {
  domains?: Array<{ id: string; kind?: string; ownedPaths?: string[] }>;
  sharedFiles?: string[] | { paths?: string[] };
  sharedKernel?: string[];
  sharedCollections?: Array<string | { collection?: string; writers?: string[] }> | Record<string, unknown>;
}

const HTTP_ROUTE_VERBS = new Set(["get", "post", "put", "patch", "delete", "all"]);
const AUTH_MIDDLEWARE_RE = /auth|require|guard|verify|token|admin|role|identity|session/i;
const IGNORED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "example.com",
  "example.org",
  "w3.org",
  "www.w3.org",
  "schema.org",
  "json-schema.org",
]);

const PAAS_HOST_SUFFIXES = new Set([
  "azurewebsites.net",
  "herokuapp.com",
  "run.app",
  "cloudfunctions.net",
  "workers.dev",
  "vercel.app",
  "netlify.app",
]);

function hostLabelOf(host: string): { label: string; category: string } {
  const lower = host.toLowerCase();
  const parts = lower.split(".").filter(Boolean);
  const tail2 = parts.length >= 2 ? parts.slice(-2).join(".") : lower;
  if (tail2 === "googleapis.com") {
    return { label: "Google APIs", category: "cloud_api" };
  }
  if (PAAS_HOST_SUFFIXES.has(tail2) && parts.length >= 3) {
    const appPart = parts[0] ?? lower;
    return { label: appPart.charAt(0).toUpperCase() + appPart.slice(1), category: "external_http" };
  }
  const core = parts.length >= 2 ? (parts[parts.length - 2] ?? lower) : lower;
  const label = core.charAt(0).toUpperCase() + core.slice(1);
  return { label, category: "external_http" };
}

function loadDomainConfig(
  rootDir: string,
  diagnostics: SpecDiagnostic[],
): {
  domainForFile: (relFile: string) => string | null;
  authorizedSharedCollections: Set<string>;
  hasDeclaredDomains: boolean;
} {
  const domPath = path.join(rootDir, "tools/domains.json");
  if (!fs.existsSync(domPath)) {
    return {
      domainForFile: () => null,
      authorizedSharedCollections: new Set<string>(),
      hasDeclaredDomains: false,
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(domPath, "utf8")) as DomainsJson;
    const rawSharedFiles = Array.isArray(parsed.sharedFiles)
      ? parsed.sharedFiles
      : parsed.sharedFiles && typeof parsed.sharedFiles === "object" && Array.isArray(parsed.sharedFiles.paths)
        ? parsed.sharedFiles.paths
        : [];
    const rawKernel = Array.isArray(parsed.sharedKernel) ? parsed.sharedKernel : [];
    const sharedSet = new Set<string>([...rawSharedFiles, ...rawKernel]);

    const rules: Array<{ id: string; prefix: string }> = [];
    for (const d of parsed.domains ?? []) {
      for (const p of d.ownedPaths ?? []) {
        rules.push({ id: d.id, prefix: p.replace(/\/+$/, "") });
      }
    }
    rules.sort((a, b) => b.prefix.length - a.prefix.length);

    const authShared = new Set<string>();
    if (Array.isArray(parsed.sharedCollections)) {
      for (const item of parsed.sharedCollections) {
        if (typeof item === "string") authShared.add(item);
        else if (item && typeof item === "object" && typeof item.collection === "string") {
          authShared.add(item.collection);
        }
      }
    } else if (parsed.sharedCollections && typeof parsed.sharedCollections === "object") {
      for (const k of Object.keys(parsed.sharedCollections)) authShared.add(k);
    }

    return {
      hasDeclaredDomains: rules.length > 0,
      authorizedSharedCollections: authShared,
      domainForFile: (relFile: string) => {
        for (const sf of sharedSet) {
          if (relFile === sf || relFile.startsWith(`${sf}/`)) return null;
        }
        for (const r of rules) {
          if (relFile === r.prefix || relFile.startsWith(`${r.prefix}/`)) return r.id;
        }
        return null;
      },
    };
  } catch (err) {
    diagnostics.push({
      code: "config.domains-parse-error",
      severity: "warn",
      message: `Failed to parse tools/domains.json: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      domainForFile: () => null,
      authorizedSharedCollections: new Set<string>(),
      hasDeclaredDomains: false,
    };
  }
}

function isTestPath(relFile: string): boolean {
  return (
    /(?:^|\/)(?:__tests__|tests?|testing|e2e|fixtures|mocks)\//.test(relFile) ||
    /\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|jsx)$/.test(relFile)
  );
}

function pkgNameOf(specifier: string): string {
  if (specifier.startsWith("node:")) return specifier;
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0] ?? specifier;
}

function resolveTsSpecifier(
  fromRel: string,
  unitDir: string,
  spec: string,
  fileSet: Set<string>,
  pkgNameToEntry: Map<string, { unitName: string; entryFile: string }>,
): string | null {
  const tryCandidates = (base: string): string | null => {
    const cands = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mts`,
      `${base}.js`,
      `${base}.jsx`,
      `${base}.mjs`,
      `${base}.cjs`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
      `${base}/index.js`,
      `${base}/index.mjs`,
      base.replace(/\.js$/, ".ts"),
      base.replace(/\.mjs$/, ".ts"),
    ];
    for (const c of cands) {
      if (fileSet.has(c)) return c;
    }
    return null;
  };

  if (spec.startsWith(".")) {
    const dir = path.posix.dirname(fromRel);
    return tryCandidates(path.posix.normalize(path.posix.join(dir, spec)));
  }

  if (spec.startsWith("@/")) {
    const sub = spec.slice(2);
    return (
      tryCandidates(path.posix.join(unitDir, "src", sub)) ??
      tryCandidates(path.posix.join(unitDir, "functions", sub)) ??
      tryCandidates(path.posix.join(unitDir, sub))
    );
  }

  const pkg = pkgNameOf(spec);
  const entry = pkgNameToEntry.get(pkg);
  if (entry) {
    if (spec === pkg) return entry.entryFile;
    const sub = spec.slice(pkg.length + 1);
    const pkgDir = path.posix.dirname(path.posix.dirname(entry.entryFile));
    return (
      tryCandidates(path.posix.join(pkgDir, "src", sub)) ??
      tryCandidates(path.posix.join(pkgDir, sub)) ??
      entry.entryFile
    );
  }

  return null;
}

function extractStringUnionValues(typeNode: ts.TypeNode): string[] | null {
  if (!ts.isUnionTypeNode(typeNode)) return null;
  const vals: string[] = [];
  for (const member of typeNode.types) {
    if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
      vals.push(member.literal.text);
    } else {
      return null;
    }
  }
  return vals.length >= 2 ? Array.from(new Set(vals)).sort() : null;
}

function extractZodEnumValues(expr: ts.Expression): string[] | null {
  if (!ts.isCallExpression(expr)) return null;
  const callee = expr.expression.getText();
  if (!callee.endsWith(".enum")) return null;
  const arg0 = expr.arguments[0];
  if (!arg0 || !ts.isArrayLiteralExpression(arg0)) return null;
  const vals: string[] = [];
  for (const el of arg0.elements) {
    if (ts.isStringLiteral(el)) vals.push(el.text);
    else return null;
  }
  return vals.length >= 2 ? Array.from(new Set(vals)).sort() : null;
}

function isPureBarrelFile(sf: ts.SourceFile): boolean {
  if (sf.statements.length === 0) return false;
  let hasExport = false;
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt)) {
      hasExport = true;
      continue;
    }
    if (ts.isImportDeclaration(stmt)) continue;
    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) continue;
    return false;
  }
  return hasExport;
}

function isHttpCallContext(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent;
  for (let depth = 0; depth < 6 && cur; depth += 1) {
    if (ts.isCallExpression(cur)) {
      const txt = cur.expression.getText().toLowerCase();
      if (
        txt === "fetch" ||
        txt.endsWith(".fetch") ||
        txt.includes("axios") ||
        txt.includes("request") ||
        txt.endsWith(".get") ||
        txt.endsWith(".post") ||
        txt.endsWith(".put") ||
        txt.endsWith(".patch") ||
        txt.endsWith(".delete")
      ) {
        return true;
      }
    }
    if (ts.isNewExpression(cur)) {
      const txt = cur.expression.getText();
      if (txt === "URL" || txt === "Request") return true;
    }
    cur = cur.parent;
  }
  return false;
}

function extractTsTransitionsFromFile(
  sf: ts.SourceFile,
  enumMap: Map<string, Set<string>>,
): Map<string, Array<{ from: string; event: string; to: string }>> {
  const result = new Map<string, Array<{ from: string; event: string; to: string }>>();
  if (enumMap.size === 0) return result;

  const findOwnerEnum = (values: string[]): string | null => {
    for (const [name, set] of enumMap) {
      if (values.length > 0 && values.every((v) => set.has(v))) return name;
    }
    return null;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const varName = node.name.text;
      if (/TRANSITION|NEXT_STATE|ALLOWED_/i.test(varName)) {
        const init = ts.isAsExpression(node.initializer) || ts.isSatisfiesExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer;
        if (ts.isObjectLiteralExpression(init)) {
          const pairs: Array<{ from: string; to: string }> = [];
          const touchedVals: string[] = [];
          for (const prop of init.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const fromKey = ts.isStringLiteral(prop.name) || ts.isIdentifier(prop.name) ? prop.name.text : null;
            if (!fromKey) continue;
            if (ts.isArrayLiteralExpression(prop.initializer)) {
              for (const el of prop.initializer.elements) {
                if (ts.isStringLiteral(el)) {
                  pairs.push({ from: fromKey, to: el.text });
                  touchedVals.push(fromKey, el.text);
                }
              }
            }
          }
          const owner = findOwnerEnum(touchedVals);
          if (owner && pairs.length > 0) {
            const list = result.get(owner) ?? [];
            for (const p of pairs) list.push({ from: p.from, event: "transition", to: p.to });
            result.set(owner, list);
          }
        }
      }
    }

    if (ts.isSwitchStatement(node)) {
      const pairs: Array<{ from: string; to: string }> = [];
      const touchedVals: string[] = [];
      for (const clause of node.caseBlock.clauses) {
        if (!ts.isCaseClause(clause) || !ts.isStringLiteral(clause.expression)) continue;
        const fromVal = clause.expression.text;
        const collectReturns = (n: ts.Node): void => {
          if (ts.isReturnStatement(n) && n.expression && ts.isStringLiteral(n.expression)) {
            const toVal = n.expression.text;
            if (toVal !== fromVal) {
              pairs.push({ from: fromVal, to: toVal });
              touchedVals.push(fromVal, toVal);
            }
          }
          ts.forEachChild(n, collectReturns);
        };
        for (const s of clause.statements) collectReturns(s);
      }
      const owner = findOwnerEnum(touchedVals);
      if (owner && pairs.length >= 2) {
        const list = result.get(owner) ?? [];
        for (const p of pairs) list.push({ from: p.from, event: "switch", to: p.to });
        result.set(owner, list);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return result;
}


function isTypeOnlyImportClause(clause: ts.ImportClause | undefined): boolean {
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    const els = clause.namedBindings.elements;
    return els.length > 0 && els.every((el) => el.isTypeOnly);
  }
  return false;
}

function isTypeOnlyExportDecl(decl: ts.ExportDeclaration): boolean {
  if (decl.isTypeOnly) return true;
  if (decl.exportClause && ts.isNamedExports(decl.exportClause)) {
    const els = decl.exportClause.elements;
    return els.length > 0 && els.every((el) => el.isTypeOnly);
  }
  return false;
}

export type DomainConfig = ReturnType<typeof loadDomainConfig>;

export const CODE_AST_HELPERS = {
  HTTP_ROUTE_VERBS,
  AUTH_MIDDLEWARE_RE,
  IGNORED_HOSTS,
  PAAS_HOST_SUFFIXES,
  hostLabelOf,
  loadDomainConfig,
  isTestPath,
  pkgNameOf,
  resolveTsSpecifier,
  extractStringUnionValues,
  extractZodEnumValues,
  isPureBarrelFile,
  isHttpCallContext,
  extractTsTransitionsFromFile,
  isTypeOnlyImportClause,
  isTypeOnlyExportDecl,
} as const;
