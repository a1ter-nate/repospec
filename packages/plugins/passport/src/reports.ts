import type { Database } from "bun:sqlite";
import type { ImpactReport, PrecedentsReport } from "./passport.ts";

function readMeta(db: Database, key: string): string {
  const row = db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? "";
}

export function formatImpactAsGithubMarkdown(report: ImpactReport): string {
  const lines: string[] = [
    `## RepoSpec Architecture Impact (\`${report.range}\`)`,
    `- **Spec Digest:** \`${report.specDigest.slice(0, 12)}\` · **Touched Files:** ${report.touchedFiles.length} (${report.units.length} unit(s))`,
    `- **Units & Layers:** ${report.layers.length > 0 ? report.layers.map((l) => `\`${l}\``).join(", ") : "none"}`,
  ];
  if (report.entities.length > 0) {
    lines.push(`- **Datastore Entities:** ${report.entities.map((e) => `\`${e}\``).join(", ")}`);
  }
  if (report.fkCascades.length > 0) {
    lines.push(
      `- **FK Cascades:** ${report.fkCascades.slice(0, 5).map((f) => `\`${f.fromTable} -> ${f.toTable}\` (${f.onDelete})`).join(", ")}`,
    );
  }
  if (report.machines.length > 0) {
    lines.push(`- **State Machines:** ${report.machines.map((m) => `\`${m}\``).join(", ")}`);
  }
  if (report.endpoints.length > 0) {
    lines.push(`- **Endpoints:** ${report.endpoints.slice(0, 6).map((e) => `\`${e.method} ${e.path}\` (${e.authGuard ?? "unannotated"})`).join(", ")}`);
  }
  if (report.testsToRun.length > 0) {
    lines.push(`- **Direct Tests (${report.testsToRun.length}):** ${report.testsToRun.slice(0, 8).map((t) => `\`${t}\``).join(", ")}`);
  }
  if (report.ciWorkflows.length > 0) {
    lines.push(`- **CI Workflows:** ${report.ciWorkflows.map((w) => `\`${w}\``).join(", ")}`);
  }
  if (report.symbolSlice && (report.symbolSlice.changedSymbols.length > 0 || report.symbolSlice.impactedConsumers.length > 0)) {
    lines.push(
      `- **Symbol Slice:** ${report.symbolSlice.changedSymbols.length} symbol(s) changed → ${report.symbolSlice.impactedConsumers.length} transitive consumer(s) (vs ${report.symbolSlice.coarseFileConsumers} file-level, ${report.symbolSlice.precisionGainPct}% narrowed)`,
    );
  }
  if (report.changeRisk) {
    lines.push(
      `- **Change Risk (Kamei / Bird):** entropy=${report.changeRisk.kameiEntropy}, prior bug-fix touches=${report.changeRisk.priorBugFixTouches}, low-ownership files=${report.changeRisk.lowOwnershipFiles.length}`,
    );
  }
  if (report.activeViolations.length > 0) {
    lines.push("", "### Active Invariant Violations on Touched Files");
    for (const v of report.activeViolations.slice(0, 10)) {
      lines.push(`- **[${v.severity.toUpperCase()}]** \`${v.ruleId}\` at \`${v.file}:${v.line}\` — ${v.detail}`);
    }
  }
  if (report.refusals.length > 0) {
    lines.push("", "### Signal Refusals");
    for (const r of report.refusals.slice(0, 5)) lines.push(`- ${r}`);
  }
  return lines.join("\n");
}

export function buildPrecedentsReport(
  db: Database,
  query: { path?: string; intent?: string },
): PrecedentsReport {
  const digest = readMeta(db, "specDigest");
  const targetPath = query.path?.trim();
  const intent = query.intent?.trim().toLowerCase();

  const loadProhibitions = (prefix: string): PrecedentsReport["prohibitions"] =>
    db
      .query(
        `SELECT id, symbol, text, rationale, file
         FROM gov_rules
         WHERE kind IN ('prohibition', 'instruction', 'diagnostic')
           AND (scope_prefix = '' OR ? = scope_prefix OR ? LIKE scope_prefix || '/%')
         ORDER BY LENGTH(scope_prefix) DESC LIMIT 15`,
      )
      .all(prefix, prefix) as PrecedentsReport["prohibitions"];

  if (targetPath) {
    const dir = targetPath.includes("/") ? targetPath.slice(0, targetPath.lastIndexOf("/")) : "";
    const siblings = db
      .query(
        `SELECT file, unit, layer, canonical_layer AS canonicalLayer, layer_source
         FROM files
         WHERE is_test = 0 AND file LIKE ? || '/%' AND file NOT LIKE ? || '/%/%'
         ORDER BY file ASC LIMIT 10`,
      )
      .all(dir, dir) as Array<{
      file: string;
      unit: string;
      layer: string;
      canonicalLayer: string;
      layer_source: string;
    }>;

    const prohibitions = loadProhibitions(dir || targetPath);
    const trustedSiblings = siblings.filter((s) => s.layer_source !== "token_heuristic" && s.canonicalLayer !== "unclassified");

    if (trustedSiblings.length >= 3) {
      return {
        schema: "repospec.passport/v1",
        kind: "precedents",
        specDigest: digest,
        query,
        advisory: "observed",
        reason: `Found ${trustedSiblings.length} verified sibling precedents in ${dir}/.`,
        destination: dir,
        exemplars: trustedSiblings.slice(0, 5).map(({ file, unit, layer, canonicalLayer }) => ({
          file,
          unit,
          layer,
          canonicalLayer,
        })),
        prohibitions,
      };
    }

    if (prohibitions.length > 0) {
      return {
        schema: "repospec.passport/v1",
        kind: "precedents",
        specDigest: digest,
        query,
        advisory: "constrained",
        reason: `Fewer than 3 verified sibling precedents in "${dir || "."}". Returning declared prohibitions only; destination withheld.`,
        destination: null,
        exemplars: trustedSiblings.slice(0, 3).map(({ file, unit, layer, canonicalLayer }) => ({
          file,
          unit,
          layer,
          canonicalLayer,
        })),
        prohibitions,
      };
    }

    return {
      schema: "repospec.passport/v1",
      kind: "precedents",
      specDigest: digest,
      query,
      advisory: "refuse",
      reason: `Insufficient verified precedents (${trustedSiblings.length} < 3) and no declared governance rules for "${targetPath}".`,
      destination: null,
      exemplars: [],
      prohibitions: [],
    };
  }

  if (intent) {
    const targetCanonical =
      /endpoint|route|http|webhook|controller|api/.test(intent)
        ? "transport"
        : /table|collection|firestore|postgres|sql|dao|query|write|read|db/.test(intent)
          ? "persistence"
          : /vendor|client|sdk|external|http_client|third-party/.test(intent)
            ? "integration"
            : /machine|state|domain|model|entity/.test(intent)
              ? "domain"
              : null;

    if (!targetCanonical) {
      return {
        schema: "repospec.passport/v1",
        kind: "precedents",
        specDigest: digest,
        query,
        advisory: "refuse",
        reason: `Intent "${query.intent}" does not map cleanly to a canonical layer role.`,
        destination: null,
        exemplars: [],
        prohibitions: loadProhibitions(""),
      };
    }

    const candidates = db
      .query(
        `SELECT file, unit, layer, canonical_layer AS canonicalLayer
         FROM v_prod_files
         WHERE canonical_layer = ? AND layer_source != 'token_heuristic'
         ORDER BY file ASC LIMIT 12`,
      )
      .all(targetCanonical) as Array<{ file: string; unit: string; layer: string; canonicalLayer: string }>;

    const dirCounts = new Map<string, number>();
    for (const c of candidates) {
      const d = c.file.includes("/") ? c.file.slice(0, c.file.lastIndexOf("/")) : ".";
      dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
    }
    const topDir = Array.from(dirCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

    if (topDir && topDir[1] >= 3) {
      return {
        schema: "repospec.passport/v1",
        kind: "precedents",
        specDigest: digest,
        query,
        advisory: "observed",
        reason: `Found ${topDir[1]} verified "${targetCanonical}" precedents under ${topDir[0]}/.`,
        destination: topDir[0],
        exemplars: candidates.slice(0, 5),
        prohibitions: loadProhibitions(topDir[0]),
      };
    }

    return {
      schema: "repospec.passport/v1",
      kind: "precedents",
      specDigest: digest,
      query,
      advisory: "refuse",
      reason: `Fewer than 3 verified "${targetCanonical}" directory precedents found; refusing to guess destination.`,
      destination: null,
      exemplars: candidates.slice(0, 3),
      prohibitions: loadProhibitions(""),
    };
  }

  return {
    schema: "repospec.passport/v1",
    kind: "precedents",
    specDigest: digest,
    query,
    advisory: "refuse",
    reason: "Provide --path <relpath> or --intent <description>.",
    destination: null,
    exemplars: [],
    prohibitions: [],
  };
}
