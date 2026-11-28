import path from "node:path";
import ts from "typescript";
import type {
  AstIndexData,
  CanonicalLayer,
  EdgeEvidenceItem,
  ExportedSymbol,
  LoopRecord,
  StateMachineRecord,
  UnitDescriptor,
} from "@repospec/plugin";
import { classifyExternalPackage, classifyVendorPackage } from "@repospec/plugin";
import { detectCapabilities } from "@repospec/plugin";
import { CODE_AST_HELPERS } from "./codeAstHelpers.ts";
import { collectTsEnvRead } from "./envReads.ts";
import { extractBunServeEndpoints } from "./httpRoutes.ts";

const {
  HTTP_ROUTE_VERBS,
  AUTH_MIDDLEWARE_RE,
  IGNORED_HOSTS,
  hostLabelOf,
  pkgNameOf,
  resolveTsSpecifier,
  extractStringUnionValues,
  extractZodEnumValues,
  isPureBarrelFile,
  isHttpCallContext,
  extractTsTransitionsFromFile,
  isTypeOnlyImportClause,
  isTypeOnlyExportDecl,
} = CODE_AST_HELPERS;

export interface FileMetaEntry {
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

export interface LayerFileCountEntry {
  unitId: string;
  unitName: string;
  unitSlug: string;
  rawLayer: string;
  canonicalLayer: CanonicalLayer;
  count: number;
  sampleFile: string;
}

export function analyzeTsFiles(params: {
  tsFiles: string[];
  fileSet: Set<string>;
  pkgNameToEntry: Map<string, { unitName: string; entryFile: string }>;
  sourceFileCache: Map<string, ts.SourceFile>;
  fileMetaCache: Map<string, FileMetaEntry>;
  constStringSymbols: Map<string, string>;
  ast: AstIndexData;
  stateMachines: StateMachineRecord[];
  loops: LoopRecord[];
  layerFileCounts: Map<string, LayerFileCountEntry>;
  domainFileCounts: Map<string, { count: number; sampleFile: string }>;
  layerPairEvidence: Map<string, EdgeEvidenceItem[]>;
  domainPairEvidence: Map<string, EdgeEvidenceItem[]>;
  layerDatastoreEvidence: Map<string, EdgeEvidenceItem[]>;
  unitDatastoreEvidence: Map<string, EdgeEvidenceItem[]>;
  unitExternalEvidence: Map<string, { label: string; category: string; evidence: EdgeEvidenceItem[] }>;
  layerExternalEvidence: Map<string, { label: string; category: string; evidence: EdgeEvidenceItem[] }>;
}): void {
  const {
    tsFiles,
    fileSet,
    pkgNameToEntry,
    sourceFileCache,
    fileMetaCache,
    constStringSymbols,
    ast,
    stateMachines,
    loops,
    layerFileCounts,
    domainFileCounts,
    layerPairEvidence,
    domainPairEvidence,
    layerDatastoreEvidence,
    unitDatastoreEvidence,
    unitExternalEvidence,
    layerExternalEvidence,
  } = params;
    for (const rel of tsFiles) {
      const sf = sourceFileCache.get(rel);
      const fm = fileMetaCache.get(rel);
      if (!sf || !fm) continue;

      const text = sf.getFullText();
      const lines = text.split("\n").length;
      const isBarrel = isPureBarrelFile(sf);

      let exportsCount = 0;
      let runtimeExportsCount = 0;
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
          const typeOnly = Boolean(clause?.isTypeOnly) || isTypeOnlyImportClause(clause);
          recordImportEdge(node.moduleSpecifier.text, node.getStart(sf), typeOnly);
        }

        if (ts.isExportDeclaration(node)) {
          const typeOnlyExport = isTypeOnlyExportDecl(node);
          exportsCount += 1;
          if (!typeOnlyExport) runtimeExportsCount += 1;
          if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            recordImportEdge(node.moduleSpecifier.text, node.getStart(sf), typeOnlyExport);
          }
        }

        if (
          ts.canHaveModifiers(node) &&
          ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          exportsCount += 1;
          const isTypeOnlyDecl = ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node);
          if (!isTypeOnlyDecl) runtimeExportsCount += 1;
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

        collectTsEnvRead({ node, sf, rel, unitName: fm.unitName, isTest: fm.isTest, ast });

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

      if (!fm.isTest) {
        const bunRoutes = extractBunServeEndpoints(sf, fm.unitName, rel);
        for (const ep of bunRoutes) ast.httpEndpoints.push(ep);
      }

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
        runtimeExportsCount,
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
}
