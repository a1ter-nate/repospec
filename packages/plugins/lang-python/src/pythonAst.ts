import fs from "node:fs";
import path from "node:path";
import type {
  CanonicalLayer,
  EdgeEvidenceItem,
  ExportedSymbol,
  ExtractorPlugin,
  GraphFragment,
  LoopRecord,
  RepoContext,
  SpecEdge,
  SpecNode,
  UnitDescriptor,
} from "@repospec/plugin";
import { createEmptyAst } from "@repospec/plugin";
import {
  classifyExternalPackage,
  classifyVendorPackage,
  resolveFeatureOrLayerPath,
  resolveLayerSemantics,
} from "@repospec/plugin";
import { detectCapabilities, isExcludedCodePath } from "@repospec/plugin";

const PY_STDLIB = new Set(
  "abc argparse asyncio base64 collections concurrent configparser contextlib copy csv ctypes dataclasses datetime decimal difflib enum errno fnmatch fractions functools gc getpass glob gzip hashlib heapq hmac html http importlib inspect io itertools json logging math mimetypes multiprocessing operator os pathlib pickle platform pprint queue random re secrets shlex shutil signal socket sqlite3 ssl stat statistics string struct subprocess sys tempfile textwrap threading time timeit traceback types typing typing_extensions unittest urllib uuid warnings weakref xml zipfile zlib __future__".split(
    " ",
  ),
);

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function isPyTestPath(relFile: string): boolean {
  return (
    /(?:^|\/)(?:tests?|testing|e2e|fixtures)\//.test(relFile) ||
    /(?:^|\/)test_[^/]+\.py$/.test(relFile) ||
    relFile.endsWith("_test.py") ||
    /(?:^|\/)conftest\.py$/.test(relFile)
  );
}

function extractPythonExports(text: string, relFile: string): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/^(?:(async\s+)?def|class)\s+([A-Za-z][A-Za-z0-9_]*)\b/gm)) {
    const full = m[0] ?? "";
    const name = m[2];
    if (!name || name.startsWith("_") || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      kind: full.startsWith("class") ? "class" : "function",
      file: relFile,
      line: lineOf(text, m.index ?? 0),
    });
    if (out.length >= 24) break;
  }
  return out;
}

function resolvePythonRelative(
  fromRel: string,
  dots: string,
  modTail: string,
  fileSet: Set<string>,
): string | null {
  let baseDir = path.posix.dirname(fromRel);
  const upSteps = Math.max(0, dots.length - 1);
  for (let i = 0; i < upSteps; i += 1) {
    baseDir = path.posix.dirname(baseDir);
  }
  const segs = modTail ? modTail.split(".").filter(Boolean) : [];
  const targetBase = baseDir === "." ? segs.join("/") : path.posix.join(baseDir, ...segs);
  const cands = [`${targetBase}.py`, `${targetBase}/__init__.py`];
  for (const c of cands) {
    if (fileSet.has(c)) return c;
  }
  if (segs.length >= 2) {
    const parentBase = baseDir === "." ? segs.slice(0, -1).join("/") : path.posix.join(baseDir, ...segs.slice(0, -1));
    if (fileSet.has(`${parentBase}.py`)) return `${parentBase}.py`;
  }
  return null;
}

export const pythonAstExtractor: ExtractorPlugin = {
  id: "arch.python-ast.v5",
  domain: "arch",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const pyFiles = ctx.allFiles.filter((f) => f.endsWith(".py") && (!isExcludedCodePath(f) || isPyTestPath(f)));
    if (pyFiles.length === 0) {
      return { nodes: [], edges: [], rules: [] };
    }

    const ast = createEmptyAst();
    const nodes: SpecNode[] = [];
    const edges: SpecEdge[] = [];
    const loops: LoopRecord[] = [];
    const fileSet = new Set(pyFiles);

    const sortedUnits = [...ctx.units].filter((u) => !u.external && u.dir !== ".").sort((a, b) => b.dir.length - a.dir.length);
    const rootUnit = ctx.units.find((u) => u.dir === ".") ?? null;
    const validUnitIds = new Set(ctx.units.map((u) => u.id));

    const resolveUnit = (rel: string): UnitDescriptor | null => {
      for (const u of sortedUnits) {
        if (rel === u.dir || rel.startsWith(`${u.dir}/`)) return u;
      }
      return rootUnit;
    };

    const dottedToFile = new Map<string, string>();
    for (const rel of pyFiles) {
      const unit = resolveUnit(rel);
      const unitPrefix = unit && unit.dir !== "." ? `${unit.dir}/` : "";
      const inner = unitPrefix && rel.startsWith(unitPrefix) ? rel.slice(unitPrefix.length) : rel;
      const strippedSrc = inner.replace(/^src\//, "");
      const asDotted = strippedSrc.replace(/\/__init__\.py$/, "").replace(/\.py$/, "").replace(/\//g, ".");
      if (asDotted) dottedToFile.set(asDotted, rel);
    }

    interface ParsedPy {
      rel: string;
      text: string;
      unit: UnitDescriptor | null;
      unitId: string;
      unitName: string;
      unitSlug: string;
      rawLayer: string;
      canonicalLayer: CanonicalLayer;
      domainArea: string | null;
      isTest: boolean;
    }

    const parsedFiles: ParsedPy[] = [];
    const parsedByRel = new Map<string, ParsedPy>();

    for (const rel of pyFiles) {
      let text = "";
      try {
        text = fs.readFileSync(path.join(ctx.rootDir, rel), "utf8");
      } catch {
        continue;
      }
      const unit = resolveUnit(rel);
      const unitId = unit?.id ?? `arch:app:${ctx.repoName}`;
      const unitName = unit?.name ?? ctx.repoName;
      const unitSlug = unit?.slug ?? ctx.repoName;
      const isTest = isPyTestPath(rel) || unit?.kind === "test_package";
      const pathInfo = resolveFeatureOrLayerPath(rel, unit?.dir ?? ".");
      const rawLayer = isTest ? "tests" : pathInfo.rawLayer;
      const canonicalLayer: CanonicalLayer = isTest ? "tests" : pathInfo.canonicalLayer;
      const exportedSymbols = isTest ? [] : extractPythonExports(text, rel);
      const capabilities = detectCapabilities(text);
      const isBarrel = rel.endsWith("/__init__.py") && text.split("\n").length <= 40;

      ast.files.push({
        file: rel,
        unit: unitName,
        language: "python",
        layer: rawLayer,
        canonicalLayer,
        domainArea: isTest ? null : pathInfo.inferredDomain,
        layerSource: "path_convention",
        domainSource: !isTest && pathInfo.inferredDomain ? "path_convention" : "none",
        isTest,
        isBarrel,
        lines: text.split("\n").length,
        exportsCount: exportedSymbols.length,
        exportedSymbols,
        capabilities,
      });

      const rec: ParsedPy = {
        rel,
        text,
        unit,
        unitId,
        unitName,
        unitSlug,
        rawLayer,
        canonicalLayer,
        domainArea: isTest ? null : pathInfo.inferredDomain,
        isTest,
      };
      parsedFiles.push(rec);
      parsedByRel.set(rel, rec);
    }

    const unitExternalEvidence = new Map<string, { label: string; category: string; evidence: EdgeEvidenceItem[] }>();
    const layerFileCounts = new Map<
      string,
      { unitId: string; unitName: string; unitSlug: string; rawLayer: string; canonicalLayer: CanonicalLayer; count: number; sampleFile: string }
    >();
    const layerPairEvidence = new Map<string, EdgeEvidenceItem[]>();

    for (const pf of parsedFiles) {
      const { rel, text, unitId, unitName, unitSlug, rawLayer, canonicalLayer, domainArea, isTest } = pf;

      if (!isTest && canonicalLayer !== "ops_script" && canonicalLayer !== "unclassified" && validUnitIds.has(unitId)) {
        const lk = `${unitSlug}::${rawLayer}`;
        const cur = layerFileCounts.get(lk);
        if (cur) cur.count += 1;
        else {
          layerFileCounts.set(lk, {
            unitId,
            unitName,
            unitSlug,
            rawLayer,
            canonicalLayer,
            count: 1,
            sampleFile: rel,
          });
        }
      }

      const recordResolved = (targetRel: string, ln: number): void => {
        if (targetRel === rel) return;
        const target = parsedByRel.get(targetRel);
        if (!target) return;
        ast.fileImports.push({
          fromFile: rel,
          toFile: targetRel,
          fromUnit: unitName,
          toUnit: target.unitName,
          fromLayer: rawLayer,
          toLayer: target.rawLayer,
          fromCanonicalLayer: canonicalLayer,
          toCanonicalLayer: target.canonicalLayer,
          fromDomain: domainArea,
          toDomain: target.domainArea,
          line: ln,
          typeOnly: false,
        });
        if (!isTest && !target.isTest && unitId === target.unitId && rawLayer !== target.rawLayer) {
          const ek = `${unitSlug}:${rawLayer}>${unitSlug}:${target.rawLayer}`;
          const list = layerPairEvidence.get(ek) ?? [];
          list.push({ file: rel, line: ln, detail: `imports ${targetRel}` });
          layerPairEvidence.set(ek, list);
        }
      };

      const recordExternal = (pkg: string, ln: number): void => {
        if (!pkg || PY_STDLIB.has(pkg)) return;
        const vendorCategory = classifyVendorPackage(pkg);
        ast.pkgImports.push({
          fromFile: rel,
          unit: unitName,
          layer: rawLayer,
          canonicalLayer,
          pkg,
          vendorCategory,
          line: ln,
          typeOnly: false,
        });
        if (!isTest && validUnitIds.has(unitId)) {
          const extInfo = classifyExternalPackage(pkg);
          if (extInfo && extInfo.kind !== "transport") {
            const extId = `arch:ext:${extInfo.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
            const ev: EdgeEvidenceItem = { file: rel, line: ln, detail: `imports ${pkg}` };
            const uKey = `${unitId}>${extId}`;
            const cur = unitExternalEvidence.get(uKey);
            if (cur) cur.evidence.push(ev);
            else unitExternalEvidence.set(uKey, { label: extInfo.label, category: extInfo.category, evidence: [ev] });
          }
        }
      };

      for (const m of text.matchAll(/^\s*from\s+(\.+)([A-Za-z0-9_.]*)\s+import\s+([^\n#]+)/gm)) {
        const dots = m[1] ?? ".";
        const tail = m[2] ?? "";
        const importedNames = (m[3] ?? "").replace(/[()]/g, "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0]?.trim() ?? "").filter(Boolean);
        const ln = lineOf(text, m.index ?? 0);
        const direct = resolvePythonRelative(rel, dots, tail, fileSet);
        if (direct) {
          recordResolved(direct, ln);
        } else if (!tail) {
          for (const nm of importedNames) {
            const sub = resolvePythonRelative(rel, dots, nm, fileSet);
            if (sub) recordResolved(sub, ln);
          }
        }
      }

      for (const m of text.matchAll(/^\s*from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\s+([^\n#]+)/gm)) {
        const modPath = m[1] ?? "";
        const importedNames = (m[2] ?? "").replace(/[()]/g, "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0]?.trim() ?? "").filter(Boolean);
        const ln = lineOf(text, m.index ?? 0);
        const direct = dottedToFile.get(modPath);
        if (direct) {
          recordResolved(direct, ln);
        } else {
          let resolvedAny = false;
          for (const nm of importedNames) {
            const sub = dottedToFile.get(`${modPath}.${nm}`);
            if (sub) {
              recordResolved(sub, ln);
              resolvedAny = true;
            }
          }
          if (!resolvedAny) {
            const topPkg = modPath.split(".")[0] ?? modPath;
            recordExternal(topPkg, ln);
          }
        }
      }

      for (const m of text.matchAll(/^\s*import\s+([A-Za-z_][A-Za-z0-9_.,\s]*)/gm)) {
        const ln = lineOf(text, m.index ?? 0);
        const items = (m[1] ?? "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0]?.trim() ?? "").filter(Boolean);
        for (const modPath of items) {
          const direct = dottedToFile.get(modPath);
          if (direct) recordResolved(direct, ln);
          else recordExternal(modPath.split(".")[0] ?? modPath, ln);
        }
      }

      if (isTest) continue;

      for (const rm of text.matchAll(/@(?:app|router|bp|blueprint)\.(get|post|put|patch|delete|route)\s*\(\s*["']([^"']+)["']/gi)) {
        const verb = (rm[1] ?? "GET").toUpperCase();
        const routePath = rm[2] ?? "/";
        ast.httpEndpoints.push({
          unit: unitName,
          method: verb === "ROUTE" ? "ANY" : verb,
          path: routePath,
          authGuard: /Depends\s*\([^)]*auth|@login_required|@require_auth/i.test(text) ? "auth_guard" : null,
          source: "ast",
          resolution: routePath === "/" ? "fragment" : "mounted",
          handlerFile: rel,
          line: lineOf(text, rm.index ?? 0),
          operationId: null,
        });
      }

      for (const em of text.matchAll(/\bos\.(?:environ(?:\.get)?\s*[[(]|getenv\s*\()\s*["']([A-Z][A-Z0-9_]{2,})["']/g)) {
        const envName = em[1];
        if (envName) {
          ast.envBindings.push({
            envName,
            sourceKind: "code_read",
            unit: unitName,
            file: rel,
            line: lineOf(text, em.index ?? 0),
            isSecret: /SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|DATABASE_URL/i.test(envName),
          });
        }
      }

      for (const lm of text.matchAll(/@(?:scheduler|celery|app)\.task|schedule\.every\s*\(/g)) {
        const ln = lineOf(text, lm.index ?? 0);
        loops.push({
          id: `arch:loop:py:${rel}:${ln}`,
          name: `${path.posix.basename(rel)} (scheduled task)`,
          kind: "scheduler",
          schedule: null,
          unit: unitName,
          provenance: { file: rel, line: ln },
        });
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
        tags: ["python", "layer", info.canonicalLayer, sem.axis],
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
      edges.push({
        from: info.unitId,
        to: lid,
        kind: "contains",
        confidence: "observed",
        provenance: { file: info.sampleFile },
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
        evidence: evList.slice(0, 12),
      });
    }

    const extNodes = new Map<string, { label: string; category: string; count: number; sampleFile: string }>();
    for (const [key, entry] of Array.from(unitExternalEvidence.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const [unitId, extId] = key.split(">");
      if (!unitId || !extId || !validUnitIds.has(unitId)) continue;
      const cur = extNodes.get(extId);
      if (cur) cur.count += entry.evidence.length;
      else {
        extNodes.set(extId, {
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

    for (const [extId, info] of Array.from(extNodes.entries()).sort(([a], [b]) => a.localeCompare(b))) {
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

    return { nodes, edges, rules: [], loops, ast };
  },
};
