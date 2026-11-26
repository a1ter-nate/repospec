import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type {
  CanonicalLayer,
  EdgeEvidenceItem,
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
import { resolveFeatureOrLayerPath } from "../taxonomy.ts";
import { isExcludedCodePath } from "./moduleFacts.ts";
import { CODE_AST_HELPERS } from "../internal/extractors/codeAstHelpers.ts";
import { analyzeTsFiles, type FileMetaEntry, type LayerFileCountEntry } from "../internal/extractors/codeAstWalk.ts";
import { emitCodeAstGraph } from "../internal/extractors/codeAstEmit.ts";

const { loadDomainConfig, isTestPath } = CODE_AST_HELPERS;

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

    const fileMetaCache = new Map<string, FileMetaEntry>();

    for (const rel of tsFiles) {
      const uInfo = unitInfoFor(rel);
      const isTest = isTestPath(rel) || uInfo.unit?.kind === "test_package";
      const pathInfo = resolveFeatureOrLayerPath(rel, uInfo.unitDir);
      const unitRel = uInfo.unitDir !== "." && rel.startsWith(`${uInfo.unitDir}/`) ? rel.slice(uInfo.unitDir.length + 1) : rel;
      const inSrcRoot = /^(?:src|app|functions)\//.test(unitRel);
      const sfText = sourceFileCache.get(rel)?.getFullText() ?? "";
      const isStandaloneShebangScript = !isTest && !inSrcRoot && sfText.startsWith("#!");
      const rawLayer = isTest ? "tests" : isStandaloneShebangScript ? "scripts" : pathInfo.rawLayer;
      const canonicalLayer: CanonicalLayer = isTest
        ? "tests"
        : isStandaloneShebangScript
          ? "ops_script"
          : pathInfo.canonicalLayer;

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

    const layerFileCounts = new Map<string, LayerFileCountEntry>();
    const domainFileCounts = new Map<string, { count: number; sampleFile: string }>();
    const layerPairEvidence = new Map<string, EdgeEvidenceItem[]>();
    const domainPairEvidence = new Map<string, EdgeEvidenceItem[]>();
    const layerDatastoreEvidence = new Map<string, EdgeEvidenceItem[]>();
    const unitDatastoreEvidence = new Map<string, EdgeEvidenceItem[]>();
    const unitExternalEvidence = new Map<string, { label: string; category: string; evidence: EdgeEvidenceItem[] }>();
    const layerExternalEvidence = new Map<string, { label: string; category: string; evidence: EdgeEvidenceItem[] }>();


    analyzeTsFiles({
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
    });

    emitCodeAstGraph({
      validUnitIds,
      indexesRel,
      domainConfig,
      ast,
      layerFileCounts,
      domainFileCounts,
      layerPairEvidence,
      domainPairEvidence,
      layerDatastoreEvidence,
      unitDatastoreEvidence,
      unitExternalEvidence,
      layerExternalEvidence,
      nodes,
      edges,
    });

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
