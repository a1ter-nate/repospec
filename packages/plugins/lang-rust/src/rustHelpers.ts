import fs from "node:fs";
import path from "node:path";
import type { AstDeclaredEntityFact, CanonicalLayer, DbForeignKeyFact, RepoContext, UnitDescriptor } from "@repospec/plugin";

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function stripRustTestBlocks(text: string): string {
  const idx = text.search(/#\[cfg\(test\)\]/);
  return idx >= 0 ? text.slice(0, idx) : text;
}

function extractBraceBlock(text: string, openBraceIdx: number): string {
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = openBraceIdx; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") {
      inStr = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(openBraceIdx + 1, i);
    }
  }
  return text.slice(openBraceIdx + 1);
}

function moduleOfRustFile(relFile: string, crateDir: string): string {
  const prefix = crateDir === "." ? "" : `${crateDir}/`;
  const inner = relFile.startsWith(prefix) ? relFile.slice(prefix.length) : relFile;
  const cleaned = inner.replace(/^src\//, "");
  const parts = cleaned.split("/");
  if (parts.length > 1) return parts[0] ?? "lib";
  return (parts[0] ?? "lib").replace(/\.rs$/, "");
}

function isRustSubdirModule(relFile: string, crateDir: string): string | null {
  const prefix = crateDir === "." ? "src/" : `${crateDir}/src/`;
  if (!relFile.startsWith(prefix)) return null;
  const inner = relFile.slice(prefix.length);
  const parts = inner.split("/");
  if (parts.length >= 2 && parts[0]) return parts[0];
  return null;
}

function classifyRustFile(
  relFile: string,
  prodText: string,
  unit: UnitDescriptor | null,
): { rawLayer: string; canonicalLayer: CanonicalLayer; source: "path_convention" | "token_heuristic" } {
  const lower = relFile.toLowerCase();
  if (/(?:^|\/)(?:examples|benches|xtask)\//.test(lower)) {
    return { rawLayer: "examples", canonicalLayer: "ops_script", source: "path_convention" };
  }
  if (/(?:^|\/)(?:tests|fuzz)\//.test(lower) || lower.endsWith("_tests.rs")) {
    return { rawLayer: "tests", canonicalLayer: "tests", source: "path_convention" };
  }
  if (lower.includes("/routes/") || lower.includes("/handlers/")) {
    return { rawLayer: "routes", canonicalLayer: "transport", source: "path_convention" };
  }
  if (lower.includes("/db/") || lower.includes("/repositories/") || lower.includes("/persistence/") || lower.includes("/store/")) {
    return { rawLayer: "data", canonicalLayer: "persistence", source: "path_convention" };
  }
  if (lower.includes("/client/") || lower.includes("/clients/") || lower.includes("/adapters/")) {
    return { rawLayer: "client", canonicalLayer: "integration", source: "path_convention" };
  }
  if (lower.includes("/worker/") || lower.includes("/cron/") || lower.includes("/scheduler/")) {
    return { rawLayer: "loops", canonicalLayer: "runtime_loop", source: "path_convention" };
  }
  if (lower.includes("/machine") || lower.includes("/state_machines/")) {
    return { rawLayer: "state_machines", canonicalLayer: "domain", source: "path_convention" };
  }

  const isHttpUnit = unit?.archetype === "http_service";
  if (isHttpUnit && /\.route\s*\(\s*"\//.test(prodText)) {
    return { rawLayer: "routes", canonicalLayer: "transport", source: "token_heuristic" };
  }
  if (/sqlx::query/.test(prodText)) {
    return { rawLayer: "data", canonicalLayer: "persistence", source: "token_heuristic" };
  }
  if (/impl\s+Machine\s+for/.test(prodText)) {
    return { rawLayer: "state_machines", canonicalLayer: "domain", source: "token_heuristic" };
  }
  if (/tokio::time::interval/.test(prodText)) {
    return { rawLayer: "loops", canonicalLayer: "runtime_loop", source: "token_heuristic" };
  }
  if (/reqwest::/.test(prodText)) {
    return { rawLayer: "client", canonicalLayer: "integration", source: "token_heuristic" };
  }
  return { rawLayer: "domain", canonicalLayer: "domain", source: "path_convention" };
}

function replaySqlMigrations(
  ctx: RepoContext,
): {
  declaredEntities: AstDeclaredEntityFact[];
  declaredTables: Set<string>;
  dbForeignKeys: DbForeignKeyFact[];
} {
  const migrationFiles = ctx.allFiles
    .filter((f) => /(?:^|\/)migrations\/.*\.sql$/i.test(f))
    .sort();
  const tableState = new Map<string, { declaredAt: string; hasTenancyKey: boolean }>();
  const dbForeignKeys: DbForeignKeyFact[] = [];

  for (const mig of migrationFiles) {
    let sqlText = "";
    try {
      sqlText = fs.readFileSync(path.join(ctx.rootDir, mig), "utf8");
    } catch {
      continue;
    }

    const statements = sqlText.split(";");
    let offset = 0;
    for (const stmt of statements) {
      const stmtLine = lineOf(sqlText, offset);
      offset += stmt.length + 1;

      const createTbl = stmt.match(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(([\s\S]*)\)/i,
      );
      if (createTbl?.[1]) {
        const tbl = createTbl[1].toLowerCase();
        const body = createTbl[2] ?? "";
        const hasTenancyKey = /\b(?:workspace_id|tenant_id|organization_id|org_id)\b/i.test(body);
        tableState.set(tbl, { declaredAt: mig, hasTenancyKey });

        for (const fkMatch of body.matchAll(
          /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+[^,\n]*?\bREFERENCES\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(\s*"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?/gi,
        )) {
          if (fkMatch[1] && fkMatch[2] && fkMatch[3]) {
            dbForeignKeys.push({
              datastore: "postgres",
              fromTable: tbl,
              fromColumn: fkMatch[1].toLowerCase(),
              toTable: fkMatch[2].toLowerCase(),
              toColumn: fkMatch[3].toLowerCase(),
              onDelete: fkMatch[4] ? fkMatch[4].toUpperCase().replace(/\s+/g, " ") : null,
              declaredAt: mig,
              line: stmtLine,
            });
          }
        }
        continue;
      }

      const createView = stmt.match(
        /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i,
      );
      if (createView?.[1]) {
        const viewName = createView[1].toLowerCase();
        const hasTenancyKey = /\b(?:workspace_id|tenant_id|organization_id|org_id)\b/i.test(stmt);
        tableState.set(viewName, { declaredAt: mig, hasTenancyKey });
        continue;
      }

      const dropMatch = stmt.match(
        /DROP\s+(?:TABLE|MATERIALIZED\s+VIEW|VIEW)\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i,
      );
      if (dropMatch?.[1]) {
        tableState.delete(dropMatch[1].toLowerCase());
        continue;
      }

      const renameMatch = stmt.match(
        /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+RENAME\s+TO\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i,
      );
      if (renameMatch?.[1] && renameMatch[2]) {
        const oldName = renameMatch[1].toLowerCase();
        const newName = renameMatch[2].toLowerCase();
        const prev = tableState.get(oldName);
        tableState.delete(oldName);
        tableState.set(newName, {
          declaredAt: mig,
          hasTenancyKey: prev?.hasTenancyKey ?? false,
        });
        for (const fk of dbForeignKeys) {
          if (fk.fromTable === oldName) fk.fromTable = newName;
          if (fk.toTable === oldName) fk.toTable = newName;
        }
        continue;
      }

      const alterAddCol = stmt.match(
        /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?[\s\S]*?ADD\s+COLUMN[\s\S]*/i,
      );
      if (alterAddCol?.[1]) {
        const tbl = alterAddCol[1].toLowerCase();
        const prev = tableState.get(tbl);
        if (prev && /\b(?:workspace_id|tenant_id|organization_id|org_id)\b/i.test(stmt)) {
          prev.hasTenancyKey = true;
        }
        for (const fkMatch of stmt.matchAll(
          /\b([a-zA-Z_][a-zA-Z0-9_]*)\s+[^,\n;]*?\bREFERENCES\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(\s*"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?/gi,
        )) {
          if (fkMatch[1] && fkMatch[2] && fkMatch[3]) {
            dbForeignKeys.push({
              datastore: "postgres",
              fromTable: tbl,
              fromColumn: fkMatch[1].toLowerCase(),
              toTable: fkMatch[2].toLowerCase(),
              toColumn: fkMatch[3].toLowerCase(),
              onDelete: fkMatch[4] ? fkMatch[4].toUpperCase().replace(/\s+/g, " ") : null,
              declaredAt: mig,
              line: stmtLine,
            });
          }
        }
      }
    }
  }

  const declaredTables = new Set<string>(tableState.keys());
  const declaredEntities: AstDeclaredEntityFact[] = Array.from(tableState.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entity, info]) => ({
      datastore: "postgres",
      entity,
      declaredAt: info.declaredAt,
      authorizedShared: false,
      hasTenancyKey: info.hasTenancyKey,
    }));

  const liveFks = dbForeignKeys.filter((fk) => declaredTables.has(fk.fromTable) && declaredTables.has(fk.toTable));
  return { declaredEntities, declaredTables, dbForeignKeys: liveFks };
}


export const RUST_AST_HELPERS = {
  lineOf,
  stripRustTestBlocks,
  extractBraceBlock,
  moduleOfRustFile,
  isRustSubdirModule,
  classifyRustFile,
  replaySqlMigrations,
} as const;
