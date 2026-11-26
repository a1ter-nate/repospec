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
  SpecEdge,
  SpecNode,
  SpecRule,
  StateMachineRecord,
  UnitDescriptor,
} from "../../schema.ts";
import { resolveLayerSemantics } from "../../taxonomy.ts";
import { resolveCoveragePctForFile, type RealCoverageReport } from "../coverage.ts";
import { initIndexDbSchema } from "./ddl.ts";

export function createAndPopulateIndexDb(params: {
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
}): Database {
  const {
    dbPath,
    repoName,
    commitSha,
    scopeRootRel,
    units,
    nodes,
    edges,
    rules,
    ast,
    stateMachines,
    loops,
    catalogArtifacts,
    modules = [],
    realCoverage = null,
    facts = [],
    factEdges = [],
    metrics = [],
  } = params;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = new Database(dbPath);

  initIndexDbSchema(db);

  const unitsWithExplicitPersistence = new Set<string>();
  const unitsWithExplicitIntegration = new Set<string>();
  for (const f of ast.files) {
    if (f.isTest || f.layerSource === "token_heuristic") continue;
    if (f.canonicalLayer === "persistence") unitsWithExplicitPersistence.add(f.unit);
    if (f.canonicalLayer === "integration") unitsWithExplicitIntegration.add(f.unit);
  }

  const effectiveUnits: UnitDescriptor[] =
    units.length > 0
      ? units
      : [
          {
            id: `arch:app:${repoName}`,
            name: repoName,
            slug: repoName.replace(/^@[^/]+\//, ""),
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

  const insertMeta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
  const insertUnit = db.prepare(
    "INSERT OR IGNORE INTO units (id, name, slug, dir, ecosystem, kind, archetype, layer_policy, has_persistence_layer, has_integration_layer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertNode = db.prepare(
    "INSERT OR IGNORE INTO nodes (id, domain, kind, role, label, grp, owner_id, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertEdge = db.prepare(
    "INSERT INTO edges (from_id, to_id, kind, label, weight, violation, confidence, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertRule = db.prepare(
    "INSERT OR IGNORE INTO rules (id, name, category, enforcement, rung, statement, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertRuleTarget = db.prepare("INSERT INTO rule_targets (rule_id, target) VALUES (?, ?)");
  const insertFile = db.prepare(
    "INSERT OR IGNORE INTO files (file, unit, language, layer, canonical_layer, layer_axis, layer_rank, domain_area, layer_source, domain_source, is_test, is_barrel, lines, exports_count, runtime_exports_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertFileCoverage = db.prepare(
    "INSERT OR REPLACE INTO file_coverage (file, line_pct) VALUES (?, ?)",
  );
  const insertFileImport = db.prepare(
    "INSERT INTO file_imports (from_file, to_file, from_unit, to_unit, from_layer, to_layer, from_canonical_layer, to_canonical_layer, from_domain, to_domain, line, type_only) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertPkgImport = db.prepare(
    "INSERT INTO pkg_imports (from_file, unit, layer, canonical_layer, pkg, vendor_category, line, type_only) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertDeclaredEntity = db.prepare(
    "INSERT OR IGNORE INTO declared_entities (datastore, entity, declared_at, authorized_shared, has_tenancy_key) VALUES (?, ?, ?, ?, ?)",
  );
  const insertEntityAccess = db.prepare(
    "INSERT INTO entity_access (datastore, entity, file, unit, layer, canonical_layer, domain_area, op, line, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertHost = db.prepare(
    "INSERT INTO external_hosts (file, unit, layer, canonical_layer, host, service_label, category, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertEnum = db.prepare(
    "INSERT INTO state_enums (file, unit, language, name, values_signature, line, has_transitions) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertSm = db.prepare(
    "INSERT OR IGNORE INTO state_machines (id, name, language, unit, evidence, state_count, transition_count, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertLoop = db.prepare(
    "INSERT OR IGNORE INTO loops (id, name, kind, schedule, unit, file, line) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertEndpoint = db.prepare(
    "INSERT INTO http_endpoints (unit, method, path, auth_guard, source, resolution, handler_file, line, operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertFk = db.prepare(
    "INSERT INTO db_foreign_keys (datastore, from_table, from_column, to_table, to_column, on_delete, declared_at, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertEnv = db.prepare(
    "INSERT INTO env_bindings (env_name, source_kind, unit, file, line, is_secret) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertGovRule = db.prepare(
    "INSERT OR IGNORE INTO gov_rules (id, kind, scope_prefix, symbol, text, rationale, file, line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertDocRef = db.prepare(
    "INSERT INTO doc_path_refs (doc_file, line, referenced_path, exists_in_repo) VALUES (?, ?, ?, ?)",
  );
  const insertCatalog = db.prepare(
    "INSERT OR IGNORE INTO catalog_artifacts (id, kind, file, owner_unit_id) VALUES (?, ?, ?, ?)",
  );
  const insertModuleCard = db.prepare(
    "INSERT OR REPLACE INTO module_cards (id, unit_id, unit_name, unit_slug, name, kind, rel_path, language, level, role, depth, file_count, lines, export_count, fan_in, fan_out, in_tangle, tangle_id, capabilities) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertFileSymbol = db.prepare(
    "INSERT INTO file_symbols (file, name, kind, line) VALUES (?, ?, ?, ?)",
  );
  const insertFact = db.prepare(
    "INSERT INTO facts (extractor_id, kind, key, file, line, unit, symbol, severity, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertFactEdge = db.prepare(
    "INSERT INTO fact_edges (extractor_id, kind, from_ref, to_ref, file, line, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertMetric = db.prepare(
    "INSERT OR REPLACE INTO metrics (extractor_id, scope_kind, scope_id, name, value_num, value_text) VALUES (?, ?, ?, ?, ?, ?)",
  );

  db.transaction(() => {
    insertMeta.run("schemaVersion", "5.0.0");
    insertMeta.run("repoName", repoName);
    insertMeta.run("commitSha", commitSha ?? "");
    insertMeta.run("scopeRootRel", scopeRootRel);

    for (const u of effectiveUnits) {
      insertUnit.run(
        u.id,
        u.name,
        u.slug,
        u.dir,
        u.ecosystem,
        u.kind,
        u.archetype,
        u.layerPolicy,
        unitsWithExplicitPersistence.has(u.name) ? 1 : 0,
        unitsWithExplicitIntegration.has(u.name) ? 1 : 0,
      );
    }
    for (const n of nodes) {
      insertNode.run(
        n.id,
        n.domain,
        n.kind,
        n.role ?? null,
        n.label,
        n.group ?? null,
        n.ownerId ?? null,
        n.provenance.file,
        n.provenance.line ?? null,
      );
    }
    for (const e of edges) {
      insertEdge.run(
        e.from,
        e.to,
        e.kind,
        e.label ?? null,
        e.weight ?? 1,
        e.violation ? 1 : 0,
        e.confidence,
        e.provenance?.file ?? null,
        e.provenance?.line ?? null,
      );
    }
    for (const r of rules) {
      insertRule.run(r.id, r.name, r.category, r.enforcement, r.rung, r.statement, r.provenance.file, r.provenance.line ?? null);
      for (const t of r.targets) insertRuleTarget.run(r.id, t);
    }
    for (const f of ast.files) {
      const sem = resolveLayerSemantics(f.layer, f.canonicalLayer);
      const runtimeExports = f.runtimeExportsCount ?? (f.language === "typescript" ? f.exportsCount : 1);
      insertFile.run(
        f.file,
        f.unit,
        f.language,
        f.layer,
        f.canonicalLayer,
        sem.axis,
        sem.rank,
        f.domainArea,
        f.layerSource,
        f.domainSource,
        f.isTest ? 1 : 0,
        f.isBarrel ? 1 : 0,
        f.lines,
        f.exportsCount,
        runtimeExports,
      );
      for (const sym of f.exportedSymbols ?? []) {
        insertFileSymbol.run(f.file, sym.name, sym.kind, sym.line);
      }
    }
    if (realCoverage) {
      for (const [covFile, pct] of realCoverage.fileLinePct) {
        insertFileCoverage.run(covFile, pct);
      }
      for (const f of ast.files) {
        const matched = resolveCoveragePctForFile(f.file, realCoverage);
        if (matched !== undefined) insertFileCoverage.run(f.file, matched);
      }
    }
    for (const m of modules) {
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
      );
    }
    for (const fi of ast.fileImports) {
      insertFileImport.run(
        fi.fromFile,
        fi.toFile,
        fi.fromUnit,
        fi.toUnit,
        fi.fromLayer,
        fi.toLayer,
        fi.fromCanonicalLayer,
        fi.toCanonicalLayer,
        fi.fromDomain,
        fi.toDomain,
        fi.line,
        fi.typeOnly ? 1 : 0,
      );
    }
    for (const pi of ast.pkgImports) {
      insertPkgImport.run(
        pi.fromFile,
        pi.unit,
        pi.layer,
        pi.canonicalLayer,
        pi.pkg,
        pi.vendorCategory,
        pi.line,
        pi.typeOnly ? 1 : 0,
      );
    }
    for (const de of ast.declaredEntities) {
      insertDeclaredEntity.run(
        de.datastore,
        de.entity,
        de.declaredAt,
        de.authorizedShared ? 1 : 0,
        de.hasTenancyKey ? 1 : 0,
      );
    }
    for (const ea of ast.entityAccesses) {
      insertEntityAccess.run(
        ea.datastore,
        ea.entity,
        ea.file,
        ea.unit,
        ea.layer,
        ea.canonicalLayer,
        ea.domainArea,
        ea.op,
        ea.line,
        ea.confidence,
      );
    }
    for (const h of ast.externalHosts) {
      insertHost.run(h.file, h.unit, h.layer, h.canonicalLayer, h.host, h.serviceLabel, h.category, h.line);
    }
    for (const se of ast.stateEnums) {
      insertEnum.run(se.file, se.unit, se.language, se.name, se.valuesSignature, se.line, se.hasTransitions ? 1 : 0);
    }
    for (const sm of stateMachines) {
      insertSm.run(sm.id, sm.name, sm.language, sm.unit, sm.evidence, sm.states.length, sm.transitions.length, sm.provenance.file, sm.provenance.line ?? null);
    }
    for (const lp of loops) {
      insertLoop.run(lp.id, lp.name, lp.kind, lp.schedule, lp.unit, lp.provenance.file, lp.provenance.line ?? null);
    }
    for (const ep of ast.httpEndpoints) {
      const res = ep.resolution ?? (ep.source === "openapi" ? "contract" : "mounted");
      insertEndpoint.run(ep.unit, ep.method, ep.path, ep.authGuard, ep.source, res, ep.handlerFile, ep.line, ep.operationId);
    }
    for (const fk of ast.dbForeignKeys) {
      insertFk.run(fk.datastore, fk.fromTable, fk.fromColumn, fk.toTable, fk.toColumn, fk.onDelete, fk.declaredAt, fk.line);
    }
    for (const env of ast.envBindings) {
      insertEnv.run(env.envName, env.sourceKind, env.unit, env.file, env.line, env.isSecret ? 1 : 0);
    }
    for (const gr of ast.govRules) {
      insertGovRule.run(gr.id, gr.kind, gr.scopePrefix, gr.symbol, gr.text, gr.rationale, gr.file, gr.line);
    }
    for (const dr of ast.docPathRefs) {
      insertDocRef.run(dr.docFile, dr.line, dr.referencedPath, dr.existsInRepo ? 1 : 0);
    }
    for (const ca of catalogArtifacts) {
      insertCatalog.run(ca.id, ca.kind, ca.file, ca.ownerUnitId);
    }
    for (const fact of facts) {
      insertFact.run(
        fact.extractorId,
        fact.kind,
        fact.key,
        fact.file,
        fact.line,
        fact.unit,
        fact.symbol ?? null,
        fact.severity ?? null,
        JSON.stringify(fact.payload),
      );
    }
    for (const fe of factEdges) {
      insertFactEdge.run(
        fe.extractorId,
        fe.kind,
        fe.fromRef,
        fe.toRef,
        fe.file,
        fe.line,
        fe.payload ? JSON.stringify(fe.payload) : null,
      );
    }
    for (const m of metrics) {
      insertMetric.run(m.extractorId, m.scopeKind, m.scopeId, m.name, m.valueNum ?? null, m.valueText ?? null);
    }
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
