import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import type {
  AstIndexData,
  CatalogArtifact,
  FactEdgeRecord,
  FactRecord,
  LoopRecord,
  MetricRecord,
  ModuleCard,
  RealCoverageReport,
  SpecEdge,
  SpecNode,
  SpecRule,
  StateMachineRecord,
  UnitDescriptor,
} from "@repospec/plugin";
import { resolveCoveragePctForFile, resolveLayerSemantics } from "@repospec/plugin";
import { initIndexDbSchema } from "./ddl.ts";

interface PopulateParams {
  dbPath: string;
  repoName: string;
  commitSha: string | null;
  scopeRootRel: string;
  units: UnitDescriptor[];
  nodes: SpecNode[];
  edges: SpecEdge[];
  rules: SpecRule[];
  ast: AstIndexData;
  stateMachines: StateMachineRecord[];
  loops: LoopRecord[];
  catalogArtifacts: CatalogArtifact[];
  modules?: ModuleCard[];
  realCoverage?: RealCoverageReport | null;
  facts?: FactRecord[];
  factEdges?: FactEdgeRecord[];
  metrics?: MetricRecord[];
}

function insertCoreEntities(db: Database, p: PopulateParams, effectiveUnits: UnitDescriptor[]): void {
  const unitsWithPers = new Set<string>();
  const unitsWithInt = new Set<string>();
  for (const f of p.ast.files) {
    if (f.isTest || f.layerSource === "token_heuristic") continue;
    if (f.canonicalLayer === "persistence") unitsWithPers.add(f.unit);
    if (f.canonicalLayer === "integration") unitsWithInt.add(f.unit);
  }
  const insertMeta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
  insertMeta.run("schemaVersion", "5.0.0");
  insertMeta.run("repoName", p.repoName);
  insertMeta.run("commitSha", p.commitSha ?? "");
  insertMeta.run("scopeRootRel", p.scopeRootRel);

  const insertUnit = db.prepare(
    "INSERT OR IGNORE INTO units (id, name, slug, dir, ecosystem, kind, archetype, layer_policy, has_persistence_layer, has_integration_layer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const u of effectiveUnits) {
    insertUnit.run(u.id, u.name, u.slug, u.dir, u.ecosystem, u.kind, u.archetype, u.layerPolicy, unitsWithPers.has(u.name) ? 1 : 0, unitsWithInt.has(u.name) ? 1 : 0);
  }
  const insertNode = db.prepare("INSERT OR IGNORE INTO nodes (id, domain, kind, role, label, grp, owner_id, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const n of p.nodes) {
    insertNode.run(n.id, n.domain, n.kind, n.role ?? null, n.label, n.group ?? null, n.ownerId ?? null, n.provenance.file, n.provenance.line ?? null);
  }
  const insertEdge = db.prepare("INSERT INTO edges (from_id, to_id, kind, label, weight, violation, confidence, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const e of p.edges) {
    insertEdge.run(e.from, e.to, e.kind, e.label ?? null, e.weight ?? 1, e.violation ? 1 : 0, e.confidence, e.provenance?.file ?? null, e.provenance?.line ?? null);
  }
  const insertRule = db.prepare("INSERT OR IGNORE INTO rules (id, name, category, enforcement, rung, statement, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertRuleTarget = db.prepare("INSERT INTO rule_targets (rule_id, target) VALUES (?, ?)");
  for (const r of p.rules) {
    insertRule.run(r.id, r.name, r.category, r.enforcement, r.rung, r.statement, r.provenance.file, r.provenance.line ?? null);
    for (const t of r.targets) insertRuleTarget.run(r.id, t);
  }
}

function insertFilesAndModules(db: Database, p: PopulateParams): void {
  const insertFile = db.prepare(
    "INSERT OR IGNORE INTO files (file, unit, language, layer, canonical_layer, layer_axis, layer_rank, domain_area, layer_source, domain_source, is_test, is_barrel, lines, exports_count, runtime_exports_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertFileSymbol = db.prepare("INSERT INTO file_symbols (file, name, kind, line) VALUES (?, ?, ?, ?)");
  for (const f of p.ast.files) {
    const sem = resolveLayerSemantics(f.layer, f.canonicalLayer);
    const runtimeExports = f.runtimeExportsCount ?? (f.language === "typescript" ? f.exportsCount : 1);
    insertFile.run(f.file, f.unit, f.language, f.layer, f.canonicalLayer, sem.axis, sem.rank, f.domainArea, f.layerSource, f.domainSource, f.isTest ? 1 : 0, f.isBarrel ? 1 : 0, f.lines, f.exportsCount, runtimeExports);
    for (const sym of f.exportedSymbols ?? []) insertFileSymbol.run(f.file, sym.name, sym.kind, sym.line);
  }
  if (p.realCoverage) {
    const insertCov = db.prepare("INSERT OR REPLACE INTO file_coverage (file, line_pct) VALUES (?, ?)");
    for (const [covFile, pct] of p.realCoverage.fileLinePct) insertCov.run(covFile, pct);
    for (const f of p.ast.files) {
      const matched = resolveCoveragePctForFile(f.file, p.realCoverage);
      if (matched !== undefined) insertCov.run(f.file, matched);
    }
  }
  const insertModuleCard = db.prepare(
    "INSERT OR REPLACE INTO module_cards (id, unit_id, unit_name, unit_slug, name, kind, rel_path, language, level, role, depth, file_count, lines, export_count, fan_in, fan_out, in_tangle, tangle_id, capabilities, cd, instability, abstractness, main_seq_distance, core_periphery, relative_churn, hotspot_score, contraction_blast_radius) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const m of p.modules ?? []) {
    insertModuleCard.run(
      m.id,
      m.unitId,
      m.unitName,
      m.unitSlug,
      m.name,
      m.kind,
      m.relPath,
      m.language,
      m.level,
      m.role,
      m.depth,
      m.fileCount,
      m.lines,
      m.exportCount,
      m.fanIn,
      m.fanOut,
      m.inTangle ? 1 : 0,
      m.tangleId,
      m.capabilities.join(","),
      m.cd ?? 1,
      m.instability ?? 0,
      m.abstractness ?? 0,
      m.mainSeqDistance ?? 0,
      m.corePeriphery ?? "periphery",
      m.relativeChurn ?? 0,
      m.hotspotScore ?? 0,
      m.contractionBlastRadius ?? m.fanIn,
    );
  }
}

function insertAstRelations(db: Database, ast: AstIndexData): void {
  const insertFi = db.prepare("INSERT INTO file_imports (from_file, to_file, from_unit, to_unit, from_layer, to_layer, from_canonical_layer, to_canonical_layer, from_domain, to_domain, line, type_only) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const fi of ast.fileImports) {
    insertFi.run(fi.fromFile, fi.toFile, fi.fromUnit, fi.toUnit, fi.fromLayer, fi.toLayer, fi.fromCanonicalLayer, fi.toCanonicalLayer, fi.fromDomain, fi.toDomain, fi.line, fi.typeOnly ? 1 : 0);
  }
  const insertPi = db.prepare("INSERT INTO pkg_imports (from_file, unit, layer, canonical_layer, pkg, vendor_category, line, type_only) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const pi of ast.pkgImports) insertPi.run(pi.fromFile, pi.unit, pi.layer, pi.canonicalLayer, pi.pkg, pi.vendorCategory, pi.line, pi.typeOnly ? 1 : 0);

  const insertDe = db.prepare("INSERT OR IGNORE INTO declared_entities (datastore, entity, declared_at, authorized_shared, has_tenancy_key) VALUES (?, ?, ?, ?, ?)");
  for (const de of ast.declaredEntities) insertDe.run(de.datastore, de.entity, de.declaredAt, de.authorizedShared ? 1 : 0, de.hasTenancyKey ? 1 : 0);

  const insertEa = db.prepare("INSERT INTO entity_access (datastore, entity, file, unit, layer, canonical_layer, domain_area, op, line, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const ea of ast.entityAccesses) insertEa.run(ea.datastore, ea.entity, ea.file, ea.unit, ea.layer, ea.canonicalLayer, ea.domainArea, ea.op, ea.line, ea.confidence);

  const insertHost = db.prepare("INSERT INTO external_hosts (file, unit, layer, canonical_layer, host, service_label, category, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const h of ast.externalHosts) insertHost.run(h.file, h.unit, h.layer, h.canonicalLayer, h.host, h.serviceLabel, h.category, h.line);

  const insertEnum = db.prepare("INSERT INTO state_enums (file, unit, language, name, values_signature, line, has_transitions) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const se of ast.stateEnums) insertEnum.run(se.file, se.unit, se.language, se.name, se.valuesSignature, se.line, se.hasTransitions ? 1 : 0);
}

function insertSurfacesAndExtensions(db: Database, p: PopulateParams): void {
  const insertSm = db.prepare("INSERT OR IGNORE INTO state_machines (id, name, language, unit, evidence, state_count, transition_count, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const sm of p.stateMachines) insertSm.run(sm.id, sm.name, sm.language, sm.unit, sm.evidence, sm.states.length, sm.transitions.length, sm.provenance.file, sm.provenance.line ?? null);

  const insertLoop = db.prepare("INSERT OR IGNORE INTO loops (id, name, kind, schedule, unit, file, line) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const lp of p.loops) insertLoop.run(lp.id, lp.name, lp.kind, lp.schedule, lp.unit, lp.provenance.file, lp.provenance.line ?? null);

  const insertEp = db.prepare("INSERT INTO http_endpoints (unit, method, path, auth_guard, source, resolution, handler_file, line, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const ep of p.ast.httpEndpoints) insertEp.run(ep.unit, ep.method, ep.path, ep.authGuard, ep.source, ep.resolution ?? (ep.source === "openapi" ? "contract" : "mounted"), ep.handlerFile, ep.line, ep.operationId);

  const insertFk = db.prepare("INSERT INTO db_foreign_keys (datastore, from_table, from_column, to_table, to_column, on_delete, declared_at, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const fk of p.ast.dbForeignKeys) insertFk.run(fk.datastore, fk.fromTable, fk.fromColumn, fk.toTable, fk.toColumn, fk.onDelete, fk.declaredAt, fk.line);

  const insertEnv = db.prepare("INSERT INTO env_bindings (env_name, source_kind, unit, file, line, is_secret) VALUES (?, ?, ?, ?, ?, ?)");
  for (const env of p.ast.envBindings) insertEnv.run(env.envName, env.sourceKind, env.unit, env.file, env.line, env.isSecret ? 1 : 0);

  const insertGov = db.prepare("INSERT OR IGNORE INTO gov_rules (id, kind, scope_prefix, symbol, text, rationale, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const gr of p.ast.govRules) insertGov.run(gr.id, gr.kind, gr.scopePrefix, gr.symbol, gr.text, gr.rationale, gr.file, gr.line);

  const insertDoc = db.prepare("INSERT INTO doc_path_refs (doc_file, line, referenced_path, exists_in_repo) VALUES (?, ?, ?, ?)");
  for (const dr of p.ast.docPathRefs) insertDoc.run(dr.docFile, dr.line, dr.referencedPath, dr.existsInRepo ? 1 : 0);

  const insertCat = db.prepare("INSERT OR IGNORE INTO catalog_artifacts (id, kind, file, owner_unit_id) VALUES (?, ?, ?, ?)");
  for (const ca of p.catalogArtifacts) insertCat.run(ca.id, ca.kind, ca.file, ca.ownerUnitId);

  const insertFact = db.prepare("INSERT INTO facts (extractor_id, kind, key, file, line, unit, symbol, severity, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const fact of p.facts ?? []) insertFact.run(fact.extractorId, fact.kind, fact.key, fact.file, fact.line, fact.unit, fact.symbol ?? null, fact.severity ?? null, JSON.stringify(fact.payload));

  const insertFe = db.prepare("INSERT INTO fact_edges (extractor_id, kind, from_ref, to_ref, file, line, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const fe of p.factEdges ?? []) insertFe.run(fe.extractorId, fe.kind, fe.fromRef, fe.toRef, fe.file, fe.line, fe.payload ? JSON.stringify(fe.payload) : null);

  const insertMetric = db.prepare("INSERT OR REPLACE INTO metrics (extractor_id, scope_kind, scope_id, name, value_num, value_text) VALUES (?, ?, ?, ?, ?, ?)");
  for (const m of p.metrics ?? []) insertMetric.run(m.extractorId, m.scopeKind, m.scopeId, m.name, m.valueNum ?? null, m.valueText ?? null);

  const insertCoChange = db.prepare("INSERT OR REPLACE INTO co_changes (file_a, file_b, co_commits, support, confidence) VALUES (?, ?, ?, ?, ?)");
  const insertChurn = db.prepare("INSERT OR REPLACE INTO file_churn (file, commits, added_lines, deleted_lines, relative_churn, bug_fix_commits, author_count, major_author, major_owner_pct, minor_authors) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const fact of p.facts ?? []) {
    if (fact.kind === "co_change") {
      const a = String(fact.payload.fileA ?? fact.file);
      const b = String(fact.payload.fileB ?? "");
      if (a && b) {
        insertCoChange.run(a, b, Number(fact.payload.coCommits ?? 0), Number(fact.payload.support ?? 0), Number(fact.payload.confidence ?? 0));
      }
    } else if (fact.kind === "file_churn") {
      insertChurn.run(
        fact.file,
        Number(fact.payload.commits ?? 0),
        Number(fact.payload.addedLines ?? 0),
        Number(fact.payload.deletedLines ?? 0),
        Number(fact.payload.relativeChurn ?? 0),
        Number(fact.payload.bugFixCommits ?? 0),
        Number(fact.payload.authorCount ?? 0),
        typeof fact.payload.majorAuthor === "string" ? fact.payload.majorAuthor : null,
        Number(fact.payload.majorOwnerPct ?? 0),
        Number(fact.payload.minorAuthors ?? 0),
      );
    }
  }
  const insertSymImp = db.prepare("INSERT INTO symbol_imports (from_file, to_file, symbol_name, line) VALUES (?, ?, ?, ?)");
  for (const fe of p.factEdges ?? []) {
    if (fe.kind === "imports_symbol") {
      const sym = typeof fe.payload?.symbol === "string" ? fe.payload.symbol : "";
      if (sym) insertSymImp.run(fe.fromRef, fe.toRef, sym, fe.line);
    }
  }
  db.exec(`
    UPDATE module_cards SET
      relative_churn = COALESCE((
        SELECT ROUND(AVG(fc.relative_churn), 3) FROM file_churn fc
        WHERE fc.file = module_cards.rel_path OR fc.file LIKE module_cards.rel_path || '/%'
      ), relative_churn),
      contraction_blast_radius = COALESCE((
        SELECT COUNT(DISTINCT fi.from_file) FROM file_imports fi
        JOIN files ff ON ff.file = fi.from_file AND ff.is_test = 0
        WHERE (fi.to_file = module_cards.rel_path OR fi.to_file LIKE module_cards.rel_path || '/%')
          AND fi.from_file != module_cards.rel_path AND fi.from_file NOT LIKE module_cards.rel_path || '/%'
      ), fan_in);
    UPDATE module_cards SET hotspot_score = ROUND((lines / 100.0 + fan_in + fan_out + in_tangle * 5.0) * (1.0 + relative_churn), 2);
  `);
}

export function createAndPopulateIndexDb(params: PopulateParams): Database {
  fs.mkdirSync(path.dirname(params.dbPath), { recursive: true });
  if (fs.existsSync(params.dbPath)) fs.unlinkSync(params.dbPath);
  const db = new Database(params.dbPath);
  initIndexDbSchema(db);
  const effectiveUnits: UnitDescriptor[] =
    params.units.length > 0
      ? params.units
      : [
          {
            id: `arch:app:${params.repoName}`,
            name: params.repoName,
            slug: params.repoName.replace(/^@[^/]+\//, ""),
            dir: ".",
            absDir: ".",
            manifestFile: ".",
            ecosystem: "typescript",
            kind: "app",
            archetype: "library_crate",
            layerPolicy: "flat_library",
            external: false,
            entryFile: null,
            targetFramework: null,
            bins: [],
          },
        ];
  db.transaction(() => {
    insertCoreEntities(db, params, effectiveUnits);
    insertFilesAndModules(db, params);
    insertAstRelations(db, params.ast);
    insertSurfacesAndExtensions(db, params);
  })();
  return db;
}

export function storeDigestInDb(dbPath: string, digest: string): void {
  const db = new Database(dbPath);
  try {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('specDigest', ?)").run(digest);
  } finally {
    db.close();
  }
}
