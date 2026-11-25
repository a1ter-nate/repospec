import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type {
  CanonicalLayer,
  EdgeEvidenceItem,
  ExportedSymbol,
  ExtractorPlugin,
  GraphFragment,
  LoopRecord,
  RepoContext,
  SpecDiagnostic,
  SpecEdge,
  SpecNode,
  StateMachineRecord,
  UnitDescriptor,
} from "../schema.ts";
import { createEmptyAst } from "../schema.ts";
import {
  classifyExternalPackage,
  classifyVendorPackage,
  resolveFeatureOrLayerPath,
  resolveLayerSemantics,
} from "../taxonomy.ts";
import { detectCapabilities, isExcludedCodePath } from "./moduleFacts.ts";

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

export const codeAstExtractor: ExtractorPlugin = {
  id: "arch.code-ast.v5",
  domain: "arch",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const tsFiles = ctx.allFiles.filter(
      (f) => /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f) && !f.endsWith(".d.ts") && (!isExcludedCodePath(f) || isTestPath(f)),
    );
    if (tsFiles.length === 0) {
      return { nodes: [], edges: [], rules: [] };
    }

    const diagnostics: SpecDiagnostic[] = [];
    const ast = createEmptyAst();
    const stateMachines: StateMachineRecord[] = [];
    const loops: LoopRecord[] = [];
    const nodes: SpecNode[] = [];
    const edges: SpecEdge[] = [];

    const validUnitIds = new Set(ctx.units.map((u) => u.id));
    const tsUnits = ctx.units.filter((u) => u.ecosystem === "typescript" || u.ecosystem === "javascript");
    const sortedUnits = [...tsUnits].sort((a, b) => b.dir.length - a.dir.length);
    const anyRootUnit = ctx.units.find((u) => u.dir === ".") ?? null;
    const pkgNameToEntry = new Map<string, { unitName: string; entryFile: string }>();
    for (const u of tsUnits) {
      if (u.entryFile) pkgNameToEntry.set(u.name, { unitName: u.name, entryFile: u.entryFile });
    }

    const domainConfig = loadDomainConfig(ctx.rootDir, diagnostics);
    const fileSet = new Set(ctx.allFiles);

    const declaredEntitySet = new Set<string>();
    const indexesRel = ctx.allFiles.find((f) => f.endsWith("firestore.indexes.json"));
    if (indexesRel) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(ctx.rootDir, indexesRel), "utf8")) as {
          indexes?: Array<{ collectionGroup?: string }>;
          fieldOverrides?: Array<{ collectionGroup?: string }>;
        };
        for (const item of [...(parsed.indexes ?? []), ...(parsed.fieldOverrides ?? [])]) {
          if (item.collectionGroup && !declaredEntitySet.has(item.collectionGroup)) {
            declaredEntitySet.add(item.collectionGroup);
            ast.declaredEntities.push({
              datastore: "firestore",
              entity: item.collectionGroup,
              declaredAt: indexesRel,
              authorizedShared: domainConfig.authorizedSharedCollections.has(item.collectionGroup),
            });
          }
        }
      } catch (err) {
        diagnostics.push({
          code: "config.firestore-indexes-parse-error",
          severity: "warn",
          message: `Failed to parse ${indexesRel}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    for (const sharedCol of Array.from(domainConfig.authorizedSharedCollections).sort()) {
      if (!declaredEntitySet.has(sharedCol)) {
        declaredEntitySet.add(sharedCol);
        ast.declaredEntities.push({
          datastore: "firestore",
          entity: sharedCol,
          declaredAt: "tools/domains.json",
          authorizedShared: true,
        });
      }
    }

    const constStringSymbols = new Map<string, string>();
    const sourceFileCache = new Map<string, ts.SourceFile>();

    for (const rel of tsFiles) {
      let text = "";
      try {
        text = fs.readFileSync(path.join(ctx.rootDir, rel), "utf8");
      } catch {
        continue;
      }
      const scriptKind = rel.endsWith(".tsx")
        ? ts.ScriptKind.TSX
        : rel.endsWith(".jsx")
          ? ts.ScriptKind.JSX
          : /\.(?:js|mjs|cjs)$/.test(rel)
            ? ts.ScriptKind.JS
            : ts.ScriptKind.TS;
      const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind);
      sourceFileCache.set(rel, sf);

      const scanConsts = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
          const val = ts.isStringLiteral(node.initializer)
            ? node.initializer.text
            : ts.isNoSubstitutionTemplateLiteral(node.initializer)
              ? node.initializer.text
              : null;
          if (val && /^[a-zA-Z][a-zA-Z0-9_-]{1,40}$/.test(val)) {
            constStringSymbols.set(`${rel}::${node.name.text}`, val);
            if (/^[A-Z0-9_]+$/.test(node.name.text) && node.name.text.includes("COLLECTION")) {
              constStringSymbols.set(node.name.text, val);
            }
          }
        }
        ts.forEachChild(node, scanConsts);
      };
      scanConsts(sf);
    }

    const unitInfoFor = (rel: string): { unit: UnitDescriptor | null; unitDir: string; unitName: string; unitSlug: string; unitId: string } => {
      const unit = sortedUnits.find((u) => (u.dir === "." ? true : rel.startsWith(`${u.dir}/`))) ?? anyRootUnit;
      if (unit) {
        return { unit, unitDir: unit.dir, unitName: unit.name, unitSlug: unit.slug, unitId: unit.id };
      }
      return {
        unit: null,
        unitDir: ".",
        unitName: ctx.repoName,
        unitSlug: ctx.repoName.replace(/^@[^/]+\//, ""),
        unitId: `arch:app:${ctx.repoName}`,
      };
    };

    const fileMetaCache = new Map<
      string,
      {
        unit: UnitDescriptor | null;
        unitDir: string;
        unitName: string;
        unitSlug: string;
        unitId: string;
        rawLayer: string;
        canonicalLayer: CanonicalLayer;
        domainArea: string | null;
        domainSource: "declared_manifest" | "path_convention" | "none";
        isTest: boolean;
      }
    >();

    for (const rel of tsFiles) {
      const uInfo = unitInfoFor(rel);
      const isTest = isTestPath(rel) || uInfo.unit?.kind === "test_package";
      const pathInfo = resolveFeatureOrLayerPath(rel, uInfo.unitDir);
      const rawLayer = isTest ? "tests" : pathInfo.rawLayer;
      const canonicalLayer: CanonicalLayer = isTest ? "tests" : pathInfo.canonicalLayer;

      let domainArea: string | null = null;
      let domainSource: "declared_manifest" | "path_convention" | "none" = "none";
      if (!isTest && canonicalLayer !== "ops_script") {
        if (domainConfig.hasDeclaredDomains) {
          const declared = domainConfig.domainForFile(rel);
          if (declared) {
            domainArea = declared;
            domainSource = "declared_manifest";
          }
        } else if (pathInfo.inferredDomain) {
          domainArea = pathInfo.inferredDomain;
          domainSource = "path_convention";
        }
      }

      fileMetaCache.set(rel, {
        ...uInfo,
        rawLayer,
        canonicalLayer,
        domainArea,
        domainSource,
        isTest,
      });
    }

    const layerFileCounts = new Map<
      string,
      {
        unitId: string;
        unitName: string;
        unitSlug: string;
        rawLayer: string;
        canonicalLayer: CanonicalLayer;
        count: number;
        sampleFile: string;
      }
    >();
    const domainFileCounts = new Map<string, { count: number; sampleFile: string }>();
    const layerPairEvidence = new Map<string, EdgeEvidenceItem[]>();
    const domainPairEvidence = new Map<string, EdgeEvidenceItem[]>();
    const layerDatastoreEvidence = new Map<string, EdgeEvidenceItem[]>();
    const unitDatastoreEvidence = new Map<string, EdgeEvidenceItem[]>();
    const unitExternalEvidence = new Map<string, { label: string; category: string; evidence: EdgeEvidenceItem[] }>();
    const layerExternalEvidence = new Map<string, { label: string; category: string; evidence: EdgeEvidenceItem[] }>();

    for (const rel of tsFiles) {
      const sf = sourceFileCache.get(rel);
      const fm = fileMetaCache.get(rel);
      if (!sf || !fm) continue;

      const text = sf.getFullText();
      const lines = text.split("\n").length;
      const isBarrel = isPureBarrelFile(sf);

      let exportsCount = 0;
      const exportedSymbols: ExportedSymbol[] = [];
      const seenExportNames = new Set<string>();
      const pushExportSymbol = (name: string, kind: ExportedSymbol["kind"], pos: number): void => {
        if (!name || seenExportNames.has(name) || exportedSymbols.length >= 24) return;
        seenExportNames.add(name);
        exportedSymbols.push({
          name,
          kind,
          file: rel,
          line: sf.getLineAndCharacterOfPosition(pos).line + 1,
        });
      };
      const localStateEnums = new Map<string, Set<string>>();
      const localEnumMeta = new Map<string, { values: string[]; line: number }>();

      const recordImportEdge = (spec: string, pos: number, typeOnly: boolean): void => {
        const line = sf.getLineAndCharacterOfPosition(pos).line + 1;
        const resolved = resolveTsSpecifier(rel, fm.unitDir, spec, fileSet, pkgNameToEntry);
        if (resolved) {
          const tm = fileMetaCache.get(resolved);
          const toUnit = tm?.unitName ?? fm.unitName;
          const toLayer = tm?.rawLayer ?? "root";
          const toCanonicalLayer = tm?.canonicalLayer ?? "unclassified";
          const toDomain = tm?.domainArea ?? null;

          ast.fileImports.push({
            fromFile: rel,
            toFile: resolved,
            fromUnit: fm.unitName,
            toUnit,
            fromLayer: fm.rawLayer,
            toLayer,
            fromCanonicalLayer: fm.canonicalLayer,
            toCanonicalLayer,
            fromDomain: fm.domainArea,
            toDomain,
            line,
            typeOnly,
          });

          if (!fm.isTest && !tm?.isTest && !typeOnly && fm.canonicalLayer !== "ops_script" && toCanonicalLayer !== "ops_script") {
            if (fm.unitId === tm?.unitId && fm.rawLayer !== toLayer) {
              const lk = `${fm.unitSlug}:${fm.rawLayer}>${fm.unitSlug}:${toLayer}`;
              const list = layerPairEvidence.get(lk) ?? [];
              list.push({ file: rel, line, detail: `imports ${resolved}` });
              layerPairEvidence.set(lk, list);
            }
            if (fm.domainArea && toDomain && fm.domainArea !== toDomain) {
              const dk = `${fm.domainArea}>${toDomain}`;
              const list = domainPairEvidence.get(dk) ?? [];
              list.push({ file: rel, line, detail: `imports ${resolved}` });
              domainPairEvidence.set(dk, list);
            }
          }
        } else {
          const pkg = pkgNameOf(spec);
          const vendorCategory = classifyVendorPackage(pkg);
          ast.pkgImports.push({
            fromFile: rel,
            unit: fm.unitName,
            layer: fm.rawLayer,
            canonicalLayer: fm.canonicalLayer,
            pkg,
            vendorCategory,
            line,
            typeOnly,
          });

          if (!fm.isTest && !typeOnly && fm.canonicalLayer !== "ops_script") {
            const extInfo = classifyExternalPackage(pkg);
            if (extInfo && extInfo.kind !== "transport") {
              const extId = `arch:ext:${extInfo.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
              const evItem: EdgeEvidenceItem = { file: rel, line, detail: `imports ${pkg}` };
              const uKey = `${fm.unitId}>${extId}`;
              const curU = unitExternalEvidence.get(uKey);
              if (curU) curU.evidence.push(evItem);
              else unitExternalEvidence.set(uKey, { label: extInfo.label, category: extInfo.category, evidence: [evItem] });

              const lKey = `arch:layer:${fm.unitSlug}:${fm.rawLayer}>${extId}`;
              const curL = layerExternalEvidence.get(lKey);
              if (curL) curL.evidence.push(evItem);
              else layerExternalEvidence.set(lKey, { label: extInfo.label, category: extInfo.category, evidence: [evItem] });
            }
          }
        }
      };

      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const clause = node.importClause;
          const typeOnly = Boolean(clause?.isTypeOnly);
          recordImportEdge(node.moduleSpecifier.text, node.getStart(sf), typeOnly);
        }

        if (ts.isExportDeclaration(node)) {
          exportsCount += 1;
          if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            recordImportEdge(node.moduleSpecifier.text, node.getStart(sf), Boolean(node.isTypeOnly));
          }
        }

        if (
          ts.canHaveModifiers(node) &&
          ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          exportsCount += 1;
          if (!fm.isTest) {
            const pos = node.getStart(sf);
            if (ts.isFunctionDeclaration(node) && node.name) {
              pushExportSymbol(node.name.text, "function", pos);
            } else if (ts.isClassDeclaration(node) && node.name) {
              pushExportSymbol(node.name.text, "class", pos);
            } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
              pushExportSymbol(node.name.text, "type", pos);
            } else if (ts.isVariableStatement(node)) {
              for (const decl of node.declarationList.declarations) {
                if (ts.isIdentifier(decl.name)) {
                  const isFnInit =
                    decl.initializer &&
                    (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer));
                  pushExportSymbol(decl.name.text, isFnInit ? "function" : "const", pos);
                }
              }
            }
          }
        }

        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(sf) === "process" &&
          node.expression.name.text === "env" &&
          !fm.isTest
        ) {
          const envName = node.name.text;
          if (/^[A-Z][A-Z0-9_]{2,}$/.test(envName)) {
            ast.envBindings.push({
              envName,
              sourceKind: "code_read",
              unit: fm.unitName,
              file: rel,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              isSecret: /SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL/i.test(envName),
            });
          }
        }

        if (ts.isCallExpression(node)) {
          const calleeText = node.expression.getText(sf);
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

          if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
            recordImportEdge(node.arguments[0].text, node.getStart(sf), false);
          }

          if (ts.isPropertyAccessExpression(node.expression)) {
            const propName = node.expression.name.text;
            const receiverText = node.expression.expression.getText(sf).toLowerCase();

            if (!fm.isTest && HTTP_ROUTE_VERBS.has(propName) && (receiverText.includes("router") || receiverText === "app")) {
              const arg0 = node.arguments[0];
              if (arg0 && ts.isStringLiteral(arg0) && arg0.text.startsWith("/")) {
                let authArg: string | null = null;
                for (let ai = 1; ai < node.arguments.length - 1; ai += 1) {
                  const argText = node.arguments[ai]?.getText(sf) ?? "";
                  if (AUTH_MIDDLEWARE_RE.test(argText)) {
                    authArg = argText;
                    break;
                  }
                }
                const isRootApp = receiverText === "app";
                const hasRootPrefix = /^\/(?:v\d+|api|webhooks|health|readyz|livez|\.well-known|admin|auth)\b/i.test(arg0.text);
                const resolution: "mounted" | "fragment" =
                  (isRootApp && arg0.text !== "/") || hasRootPrefix ? "mounted" : "fragment";
                ast.httpEndpoints.push({
                  unit: fm.unitName,
                  method: propName.toUpperCase(),
                  path: arg0.text,
                  authGuard: authArg,
                  source: "ast",
                  resolution,
                  handlerFile: rel,
                  line,
                  operationId: null,
                });
              }
            }

            if ((propName === "collection" || propName === "collectionGroup") && node.arguments[0]) {
              const arg = node.arguments[0];
              let colName: string | null = null;
              let conf: "observed" | "inferred" = "observed";
              if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
                colName = arg.text;
              } else if (ts.isIdentifier(arg)) {
                colName = constStringSymbols.get(`${rel}::${arg.text}`) ?? constStringSymbols.get(arg.text) ?? null;
                conf = "inferred";
              }
              if (colName && /^[a-zA-Z][a-zA-Z0-9_-]{1,48}$/.test(colName)) {
                ast.entityAccesses.push({
                  datastore: "firestore",
                  entity: colName,
                  file: rel,
                  unit: fm.unitName,
                  layer: fm.rawLayer,
                  canonicalLayer: fm.canonicalLayer,
                  domainArea: fm.domainArea,
                  op: propName === "collectionGroup" ? "GROUP" : "REF",
                  line,
                  confidence: conf,
                });
                if (!fm.isTest && fm.canonicalLayer !== "ops_script") {
                  const ev: EdgeEvidenceItem = { file: rel, line, detail: `.${propName}("${colName}")` };
                  const lKey = `arch:layer:${fm.unitSlug}:${fm.rawLayer}`;
                  const lList = layerDatastoreEvidence.get(lKey) ?? [];
                  lList.push(ev);
                  layerDatastoreEvidence.set(lKey, lList);

                  const uList = unitDatastoreEvidence.get(fm.unitId) ?? [];
                  uList.push(ev);
                  unitDatastoreEvidence.set(fm.unitId, uList);
                }
              }
            }
          }

          if (
            !fm.isTest &&
            (calleeText === "onSchedule" ||
              calleeText === "setInterval" ||
              calleeText.endsWith(".setInterval"))
          ) {
            let sched: string | null = null;
            const arg0 = node.arguments[0];
            if (arg0 && ts.isStringLiteral(arg0)) sched = arg0.text;
            loops.push({
              id: `arch:loop:ts:${rel}:${line}`,
              name: `${path.posix.basename(rel)} (${calleeText.endsWith("setInterval") ? "setInterval" : calleeText})`,
              kind: calleeText === "onSchedule" ? "cron" : "interval",
              schedule: sched,
              unit: fm.unitName,
              provenance: { file: rel, line },
            });
          }
        }

        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !fm.isTest && fm.canonicalLayer !== "ops_script") {
          const val = node.text;
          if (val.startsWith("https://") && isHttpCallContext(node)) {
            try {
              const host = new URL(val).hostname.toLowerCase();
              if (host && host.includes(".") && !IGNORED_HOSTS.has(host)) {
                const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
                const info = hostLabelOf(host);
                ast.externalHosts.push({
                  file: rel,
                  unit: fm.unitName,
                  layer: fm.rawLayer,
                  canonicalLayer: fm.canonicalLayer,
                  host,
                  serviceLabel: info.label,
                  category: info.category,
                  line,
                });
                const extId = `arch:ext:${info.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
                const ev: EdgeEvidenceItem = { file: rel, line, detail: `HTTP call to ${host}` };
                const uKey = `${fm.unitId}>${extId}`;
                const curU = unitExternalEvidence.get(uKey);
                if (curU) curU.evidence.push(ev);
                else unitExternalEvidence.set(uKey, { label: info.label, category: info.category, evidence: [ev] });

                const lKey = `arch:layer:${fm.unitSlug}:${fm.rawLayer}>${extId}`;
                const curL = layerExternalEvidence.get(lKey);
                if (curL) curL.evidence.push(ev);
                else layerExternalEvidence.set(lKey, { label: info.label, category: info.category, evidence: [ev] });
              }
            } catch {
              return;
            }
          }
        }

        if (ts.isTypeAliasDeclaration(node) && !fm.isTest) {
          const name = node.name.text;
          if (/(?:Status|State|Phase|Stage)$/i.test(name)) {
            const vals = extractStringUnionValues(node.type);
            if (vals) {
              const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
              localStateEnums.set(name, new Set(vals));
              localEnumMeta.set(name, { values: vals, line });
            }
          }
        }

        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !fm.isTest) {
          const name = node.name.text;
          if (/(?:Status|State|Phase|Stage)(?:Schema)?$/i.test(name)) {
            const vals = extractZodEnumValues(node.initializer);
            if (vals) {
              const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
              localStateEnums.set(name, new Set(vals));
              localEnumMeta.set(name, { values: vals, line });
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sf);

      const extractedTransitions = extractTsTransitionsFromFile(sf, localStateEnums);
      for (const [enumName, meta] of localEnumMeta) {
        const transitions = extractedTransitions.get(enumName) ?? [];
        ast.stateEnums.push({
          file: rel,
          unit: fm.unitName,
          language: "typescript",
          name: enumName,
          valuesSignature: meta.values.join("|"),
          values: meta.values,
          line: meta.line,
          hasTransitions: transitions.length > 0,
        });
        if (transitions.length > 0) {
          stateMachines.push({
            id: `arch:sm:ts:${fm.unitSlug}:${enumName}:${meta.line}`,
            name: enumName,
            language: "typescript",
            unit: fm.unitName,
            evidence: "inferred",
            states: meta.values,
            transitions,
            provenance: { file: rel, line: meta.line },
          });
        }
      }

      const fileLang = /\.(?:js|jsx|mjs|cjs)$/.test(rel) ? "javascript" : "typescript";
      ast.files.push({
        file: rel,
        unit: fm.unitName,
        language: fileLang,
        layer: fm.rawLayer,
        canonicalLayer: fm.canonicalLayer,
        domainArea: fm.domainArea,
        layerSource: "path_convention",
        domainSource: fm.domainSource,
        isTest: fm.isTest,
        isBarrel,
        lines,
        exportsCount,
        exportedSymbols,
        capabilities: detectCapabilities(text),
      });

      if (!fm.isTest && fm.canonicalLayer !== "ops_script" && fm.canonicalLayer !== "unclassified" && fm.unit?.kind === "app") {
        const lk = `${fm.unitSlug}::${fm.rawLayer}`;
        const cur = layerFileCounts.get(lk);
        if (cur) cur.count += 1;
        else {
          layerFileCounts.set(lk, {
            unitId: fm.unitId,
            unitName: fm.unitName,
            unitSlug: fm.unitSlug,
            rawLayer: fm.rawLayer,
            canonicalLayer: fm.canonicalLayer,
            count: 1,
            sampleFile: rel,
          });
        }
      }

      if (!fm.isTest && fm.domainArea) {
        const cur = domainFileCounts.get(fm.domainArea);
        if (cur) cur.count += 1;
        else domainFileCounts.set(fm.domainArea, { count: 1, sampleFile: rel });
      }
    }

    const validLayerIds = new Set<string>();
    for (const [, info] of Array.from(layerFileCounts.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const lid = `arch:layer:${info.unitSlug}:${info.rawLayer}`;
      const sem = resolveLayerSemantics(info.rawLayer, info.canonicalLayer);
      validLayerIds.add(lid);
      nodes.push({
        id: lid,
        domain: "arch",
        kind: "code_layer",
        role: "layer",
        label: info.rawLayer,
        group: info.unitSlug,
        ownerId: info.unitId,
        provenance: { file: info.sampleFile },
        tags: ["typescript", "layer", info.canonicalLayer, sem.axis],
        meta: {
          unit: info.unitName,
          fileCount: info.count,
          canonicalLayer: info.canonicalLayer,
          layerAxis: sem.axis,
          layerRank: sem.rank,
          laneId: sem.laneId,
          laneLabel: sem.laneLabel,
        },
      });
      if (validUnitIds.has(info.unitId)) {
        edges.push({
          from: info.unitId,
          to: lid,
          kind: "contains",
          confidence: "observed",
          provenance: { file: info.sampleFile },
        });
      }
    }

    const domainCountsSorted = Array.from(domainFileCounts.entries())
      .filter(([, v]) => v.count >= 2)
      .sort((a, b) => (b[1].count !== a[1].count ? b[1].count - a[1].count : a[0].localeCompare(b[0])));

    const validDomainIds = new Set<string>();
    for (const [dom, info] of domainCountsSorted) {
      const did = `arch:domain:${dom}`;
      validDomainIds.add(did);
      nodes.push({
        id: did,
        domain: "arch",
        kind: "domain_area",
        role: "domain",
        label: dom,
        group: domainConfig.hasDeclaredDomains ? "declared-domain" : "inferred-domain",
        provenance: { file: info.sampleFile },
        tags: ["domain", domainConfig.hasDeclaredDomains ? "declared" : "inferred"],
        meta: { fileCount: info.count, declared: domainConfig.hasDeclaredDomains },
      });
    }

    if (ast.entityAccesses.length > 0 || ast.declaredEntities.length > 0) {
      const fsId = "arch:datastore:firestore";
      const uniqueCols = new Set([
        ...ast.declaredEntities.map((d) => d.entity),
        ...ast.entityAccesses.map((a) => a.entity),
      ]);
      nodes.push({
        id: fsId,
        domain: "arch",
        kind: "datastore",
        role: "datastore",
        label: "Firestore",
        group: "datastore",
        provenance: { file: indexesRel ?? ast.entityAccesses[0]?.file ?? "." },
        tags: ["firestore", "datastore"],
        meta: { collectionCount: uniqueCols.size, accessCount: ast.entityAccesses.length },
      });

      for (const [layerId, evList] of Array.from(layerDatastoreEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
        if (!validLayerIds.has(layerId)) continue;
        edges.push({
          from: layerId,
          to: fsId,
          kind: "reads_writes",
          label: `${evList.length} refs`,
          weight: evList.length,
          confidence: "observed",
          provenance: evList[0] ? { file: evList[0].file, line: evList[0].line } : undefined,
          evidence: evList.slice(0, 15),
        });
      }
      for (const [unitId, evList] of Array.from(unitDatastoreEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
        if (!validUnitIds.has(unitId)) continue;
        edges.push({
          from: unitId,
          to: fsId,
          kind: "reads_writes",
          label: `${uniqueCols.size} colls`,
          weight: evList.length,
          confidence: "observed",
          provenance: evList[0] ? { file: evList[0].file, line: evList[0].line } : undefined,
          evidence: evList.slice(0, 15),
        });
      }
    }

    const extNodesMap = new Map<string, { label: string; category: string; count: number; sampleFile: string }>();
    for (const [key, entry] of Array.from(unitExternalEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const [unitId, extId] = key.split(">");
      if (!unitId || !extId || !validUnitIds.has(unitId)) continue;
      const cur = extNodesMap.get(extId);
      if (cur) cur.count += entry.evidence.length;
      else {
        extNodesMap.set(extId, {
          label: entry.label,
          category: entry.category,
          count: entry.evidence.length,
          sampleFile: entry.evidence[0]?.file ?? ".",
        });
      }
      edges.push({
        from: unitId,
        to: extId,
        kind: "calls_external",
        label: entry.category,
        weight: entry.evidence.length,
        confidence: "observed",
        provenance: entry.evidence[0] ? { file: entry.evidence[0].file, line: entry.evidence[0].line } : undefined,
        evidence: entry.evidence.slice(0, 10),
      });
    }

    for (const [extId, info] of Array.from(extNodesMap.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      nodes.push({
        id: extId,
        domain: "arch",
        kind: "external_service",
        role: "external",
        label: info.label,
        group: info.category,
        provenance: { file: info.sampleFile },
        tags: ["external", info.category],
        meta: { category: info.category, refCount: info.count },
      });
    }

    for (const [key, entry] of Array.from(layerExternalEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const [layerId, extId] = key.split(">");
      if (!layerId || !extId || !validLayerIds.has(layerId) || !extNodesMap.has(extId)) continue;
      edges.push({
        from: layerId,
        to: extId,
        kind: "calls_external",
        label: entry.label,
        weight: entry.evidence.length,
        confidence: "observed",
        provenance: entry.evidence[0] ? { file: entry.evidence[0].file, line: entry.evidence[0].line } : undefined,
        evidence: entry.evidence.slice(0, 10),
      });
    }

    for (const [key, evList] of Array.from(layerPairEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const [fromKey, toKey] = key.split(">");
      if (!fromKey || !toKey) continue;
      const fromId = `arch:layer:${fromKey}`;
      const toId = `arch:layer:${toKey}`;
      if (!validLayerIds.has(fromId) || !validLayerIds.has(toId)) continue;
      edges.push({
        from: fromId,
        to: toId,
        kind: "imports_layer",
        label: String(evList.length),
        weight: evList.length,
        confidence: "observed",
        provenance: evList[0] ? { file: evList[0].file, line: evList[0].line } : undefined,
        evidence: evList.slice(0, 15),
      });
    }

    for (const [key, evList] of Array.from(domainPairEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      if (evList.length < 2) continue;
      const [fromD, toD] = key.split(">");
      if (!fromD || !toD) continue;
      const fromId = `arch:domain:${fromD}`;
      const toId = `arch:domain:${toD}`;
      if (!validDomainIds.has(fromId) || !validDomainIds.has(toId)) continue;
      edges.push({
        from: fromId,
        to: toId,
        kind: "imports_domain",
        label: String(evList.length),
        weight: evList.length,
        confidence: "observed",
        provenance: evList[0] ? { file: evList[0].file, line: evList[0].line } : undefined,
        evidence: evList.slice(0, 10),
      });
    }

    return {
      nodes,
      edges,
      rules: [],
      stateMachines,
      loops,
      diagnostics,
      ast,
    };
  },
};
