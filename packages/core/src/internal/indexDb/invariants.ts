import type { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import type {
  InvariantEvidence,
  Rung,
  SpecDiagnostic,
  SpecEdge,
  SpecNode,
  SqlInvariantResult,
} from "@repospec/plugin";

interface SqlRuleFrontMatter {
  id: string;
  name: string;
  rung: Rung;
  severity: "error" | "warn" | "info";
  statement: string;
  why: string;
  fix: string;
  benefit?: string;
  sources?: Array<{ label: string; url: string }>;
  applicabilitySql: string | null;
}

function parseSqlFrontMatter(sqlText: string, fileName: string): SqlRuleFrontMatter | null {
  const fields: Record<string, string> = {};
  const sources: Array<{ label: string; url: string }> = [];
  for (const line of sqlText.split("\n")) {
    const m = line.match(/^--\s*@([a-zA-Z_]+):\s*(.+)$/);
    if (m?.[1] && m[2]) {
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (key === "source") {
        const sepIdx = val.indexOf("|");
        if (sepIdx > 0) {
          const label = val.slice(0, sepIdx).trim();
          const url = val.slice(sepIdx + 1).trim();
          if (label && url) sources.push({ label, url });
        }
      } else {
        fields[key] = val;
      }
    } else if (line.trim() && !line.trim().startsWith("--")) {
      break;
    }
  }
  const rung = fields.rung as Rung | undefined;
  const severity = fields.severity as "error" | "warn" | "info" | undefined;
  if (!fields.id || !fields.name || !rung || !severity || !fields.statement) {
    return null;
  }
  return {
    id: fields.id,
    name: fields.name,
    rung,
    severity,
    statement: fields.statement,
    why: fields.why ?? `Architectural rule defined in rules/${fileName}`,
    fix: fields.fix ?? "Resolve the reported structural issue.",
    benefit: fields.benefit,
    sources: sources.length > 0 ? sources : undefined,
    applicabilitySql: fields.applicability ?? null,
  };
}

export function runSqlInvariants(
  db: Database,
  rulesDir: string,
  diagnostics: SpecDiagnostic[],
  extraRulesDirs: readonly string[] = [],
): SqlInvariantResult[] {
  const results: SqlInvariantResult[] = [];
  const allDirs = [rulesDir, ...extraRulesDirs].filter((d) => fs.existsSync(d));
  if (allDirs.length === 0) return results;

  const insertInvRes = db.prepare(
    "INSERT OR REPLACE INTO invariant_results (id, name, rung, severity, status, applicability_reason, statement, violation_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertInvEv = db.prepare(
    "INSERT INTO invariant_evidence (rule_id, severity, subject, detail, file, line, target_node_id, edge_from_id, edge_to_id, edge_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );

  const sqlEntries: Array<{ file: string; absSql: string; displayPath: string }> = [];
  const collectSqlFiles = (baseDir: string, prefix: string, relSub: string): void => {
    const targetDir = relSub ? path.join(baseDir, relSub) : baseDir;
    const entries = fs.readdirSync(targetDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const rel = relSub ? `${relSub}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        collectSqlFiles(baseDir, prefix, rel);
      } else if (ent.isFile() && ent.name.endsWith(".sql")) {
        sqlEntries.push({
          file: rel,
          absSql: path.join(baseDir, rel),
          displayPath: `${prefix}/${rel}`,
        });
      }
    }
  };
  for (const dir of allDirs) {
    const prefix = dir === rulesDir ? "rules" : ".repospec/rules";
    collectSqlFiles(dir, prefix, "");
  }
  for (const entry of sqlEntries) {
    const { file, absSql, displayPath } = entry;
    const sqlText = fs.readFileSync(absSql, "utf8");
    const meta = parseSqlFrontMatter(sqlText, file);
    if (!meta) {
      diagnostics.push({
        code: "sql.invalid-frontmatter",
        severity: "warn",
        message: `Skipping ${displayPath}: missing @id/@name/@rung/@severity/@statement front-matter.`,
      });
      continue;
    }

    if (meta.applicabilitySql) {
      try {
        const appRow = db.query(meta.applicabilitySql).get() as Record<string, unknown> | null;
        const firstVal = appRow ? Object.values(appRow)[0] : null;
        if (typeof firstVal === "string" && firstVal.trim().length > 0) {
          insertInvRes.run(meta.id, meta.name, meta.rung, meta.severity, "na", firstVal, meta.statement, 0);
          const naRes: SqlInvariantResult = {
            id: meta.id,
            name: meta.name,
            rung: meta.rung,
            severity: meta.severity,
            status: "na",
            applicabilityReason: firstVal,
            sqlFile: displayPath,
            statement: meta.statement,
            why: meta.why,
            fix: meta.fix,
            violationCount: 0,
            evidence: [],
          };
          if (meta.benefit) naRes.benefit = meta.benefit;
          if (meta.sources) naRes.sources = meta.sources;
          results.push(naRes);
          continue;
        }
      } catch (err) {
        diagnostics.push({
          code: "sql.applicability-error",
          severity: "warn",
          message: `Applicability query failed in rules/${file}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = db.query(sqlText).all() as Array<Record<string, unknown>>;
    } catch (err) {
      diagnostics.push({
        code: "sql.rule-error",
        severity: "warn",
        message: `SQL invariant rules/${file} failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const allEvidence: InvariantEvidence[] = rows.map((row) => {
      const targetNodeId = typeof row.target_node_id === "string" ? row.target_node_id : undefined;
      const edgeFromId = typeof row.edge_from_id === "string" ? row.edge_from_id : undefined;
      const edgeToId = typeof row.edge_to_id === "string" ? row.edge_to_id : undefined;
      const edgeKind = typeof row.edge_kind === "string" ? row.edge_kind : undefined;
      const line = typeof row.line === "number" && row.line > 0 ? Math.floor(row.line) : undefined;
      return {
        subject: String(row.subject ?? "unknown"),
        detail: String(row.detail ?? meta.statement),
        file: String(row.file ?? "."),
        line,
        targetNodeId,
        edgeFromId,
        edgeToId,
        edgeKind,
      };
    });

    const status: "pass" | "warn" | "fail" =
      allEvidence.length === 0 ? "pass" : meta.severity === "error" ? "fail" : "warn";

    db.transaction(() => {
      insertInvRes.run(meta.id, meta.name, meta.rung, meta.severity, status, null, meta.statement, allEvidence.length);
      for (const ev of allEvidence) {
        insertInvEv.run(
          meta.id,
          meta.severity,
          ev.subject,
          ev.detail,
          ev.file,
          ev.line ?? 1,
          ev.targetNodeId ?? null,
          ev.edgeFromId ?? null,
          ev.edgeToId ?? null,
          ev.edgeKind ?? null,
        );
      }
    })();

    const evalRes: SqlInvariantResult = {
      id: meta.id,
      name: meta.name,
      rung: meta.rung,
      severity: meta.severity,
      status,
      sqlFile: displayPath,
      statement: meta.statement,
      why: meta.why,
      fix: meta.fix,
      violationCount: allEvidence.length,
      evidence: allEvidence.slice(0, 30),
    };
    if (meta.benefit) evalRes.benefit = meta.benefit;
    if (meta.sources) evalRes.sources = meta.sources;
    results.push(evalRes);
  }

  return results;
}

export function projectInvariantsToGraph(
  nodes: SpecNode[],
  edges: SpecEdge[],
  invariants: SqlInvariantResult[],
): { nodes: SpecNode[]; edges: SpecEdge[] } {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const nodeFindingMap = new Map<string, Map<string, { severity: "error" | "warn" | "info"; count: number }>>();
  const edgeByPair = new Map<string, SpecEdge[]>();

  for (const e of edges) {
    const key = `${e.from}|${e.to}`;
    const list = edgeByPair.get(key) ?? [];
    list.push(e);
    edgeByPair.set(key, list);
  }

  const addNodeFinding = (nodeId: string, ruleId: string, severity: "error" | "warn" | "info"): void => {
    if (!nodeById.has(nodeId)) return;
    let map = nodeFindingMap.get(nodeId);
    if (!map) {
      map = new Map();
      nodeFindingMap.set(nodeId, map);
    }
    const cur = map.get(ruleId);
    if (cur) cur.count += 1;
    else map.set(ruleId, { severity, count: 1 });

    const ownerId = nodeById.get(nodeId)?.ownerId;
    if (ownerId && ownerId !== nodeId && nodeById.has(ownerId)) {
      let oMap = nodeFindingMap.get(ownerId);
      if (!oMap) {
        oMap = new Map();
        nodeFindingMap.set(ownerId, oMap);
      }
      const oCur = oMap.get(ruleId);
      if (oCur) oCur.count += 1;
      else oMap.set(ruleId, { severity, count: 1 });
    }
  };

  for (const inv of invariants) {
    if (inv.status === "pass" || inv.status === "na") continue;
    for (const ev of inv.evidence) {
      if (ev.targetNodeId && nodeById.has(ev.targetNodeId)) {
        addNodeFinding(ev.targetNodeId, inv.id, inv.severity);
      }

      if (ev.edgeFromId && ev.edgeToId) {
        const direct = edgeByPair.get(`${ev.edgeFromId}|${ev.edgeToId}`) ?? [];
        const reverse = inv.id === "sql:bidirectional-domain-coupling"
          ? (edgeByPair.get(`${ev.edgeToId}|${ev.edgeFromId}`) ?? [])
          : [];
        const matches = [...direct, ...reverse];
        for (const edge of matches) {
          if (inv.severity === "error" || inv.severity === "warn") {
            edge.violation = true;
          }
          const rulesSet = new Set(edge.ruleIds ?? []);
          rulesSet.add(inv.id);
          edge.ruleIds = Array.from(rulesSet).sort();
          const curEv = edge.evidence ?? [];
          if (!curEv.some((x) => x.file === ev.file && x.line === ev.line)) {
            edge.evidence = [...curEv, { file: ev.file, line: ev.line, detail: ev.detail }].slice(0, 15);
          }
        }
        if (matches.length === 0 && nodeById.has(ev.edgeFromId)) {
          addNodeFinding(ev.edgeFromId, inv.id, inv.severity);
        }
      }
    }
  }

  for (const node of nodes) {
    const map = nodeFindingMap.get(node.id);
    if (map && map.size > 0) {
      node.findings = Array.from(map.entries())
        .map(([ruleId, info]) => ({ ruleId, severity: info.severity, count: info.count }))
        .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.ruleId.localeCompare(b.ruleId)));
    }
  }

  return { nodes, edges };
}
