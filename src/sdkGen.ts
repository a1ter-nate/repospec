import { DomainSchema, EdgeKindSchema, NodeKindSchema, type RepoSpecV4 } from "./schema.ts";

function formatUnion(values: string[]): string {
  if (values.length === 0) return "never";
  return values.map((v) => JSON.stringify(v)).join(" | ");
}

function formatSchemaEnum(name: string, values: string[]): string {
  if (values.length === 0) {
    return `export const ${name} = Schema.Never;`;
  }
  return `export const ${name} = Schema.Literals([${values.map((v) => JSON.stringify(v)).join(", ")}]);`;
}

export function generateIdsModule(spec: RepoSpecV4, digest: string): string {
  const appIds = spec.nodes.filter((n) => n.kind === "app" || n.kind === "native_app").map((n) => n.id);
  const pkgIds = spec.nodes.filter((n) => n.kind === "package" || n.kind === "analyzer").map((n) => n.id);
  const unitIds = spec.nodes
    .filter((n) => ["app", "native_app", "package", "test_package", "analyzer"].includes(n.kind))
    .map((n) => n.id);
  const entityNames = spec.entities.map((e) => e.entity);
  const invariantIds = spec.invariants.map((i) => i.id);
  const stateMachineIds = spec.stateMachines.map((m) => m.id);

  return `import { Schema } from "effect";

export const REPOSPEC_SCHEMA_VERSION = ${JSON.stringify(spec.schemaVersion)} as const;
export const REPOSPEC_DIGEST = ${JSON.stringify(digest)} as const;
export const REPOSPEC_REPO = ${JSON.stringify(spec.repo.name)} as const;
export const REPOSPEC_ECOSYSTEM = ${JSON.stringify(spec.repo.ecosystem)} as const;

export type Domain = ${formatUnion([...DomainSchema.literals])};
export type NodeKind = ${formatUnion([...NodeKindSchema.literals])};
export type EdgeKind = ${formatUnion([...EdgeKindSchema.literals])};
export type UnitId = ${formatUnion(unitIds)};
export type AppId = ${formatUnion(appIds)};
export type PackageId = ${formatUnion(pkgIds)};
export type EntityName = ${formatUnion(entityNames)};
export type InvariantId = ${formatUnion(invariantIds)};
export type StateMachineId = ${formatUnion(stateMachineIds)};

export const DomainSchema = Schema.Literals(${JSON.stringify([...DomainSchema.literals])});
export const NodeKindSchema = Schema.Literals(${JSON.stringify([...NodeKindSchema.literals])});
export const EdgeKindSchema = Schema.Literals(${JSON.stringify([...EdgeKindSchema.literals])});
${formatSchemaEnum("UnitIdSchema", unitIds)}
${formatSchemaEnum("AppIdSchema", appIds)}
${formatSchemaEnum("PackageIdSchema", pkgIds)}
${formatSchemaEnum("EntityNameSchema", entityNames)}
${formatSchemaEnum("InvariantIdSchema", invariantIds)}
${formatSchemaEnum("StateMachineIdSchema", stateMachineIds)}
`;
}

export function generateSqliteSdkModule(): string {
  return `import { Database } from "bun:sqlite";
import { Schema } from "effect";
import type { Domain, EdgeKind, EntityName, InvariantId, NodeKind, UnitId } from "./repospec.ids.ts";

export const REPOSPEC_SDK_RUNTIME = "bun:sqlite" as const;

export const NodeRowSchema = Schema.Struct({
  id: Schema.String,
  domain: Schema.String,
  kind: Schema.String,
  role: Schema.NullOr(Schema.String),
  label: Schema.String,
  grp: Schema.NullOr(Schema.String),
  owner_id: Schema.NullOr(Schema.String),
  file: Schema.String,
  line: Schema.NullOr(Schema.Number),
});
export type NodeRow = typeof NodeRowSchema.Type;

export const EdgeRowSchema = Schema.Struct({
  from_id: Schema.String,
  to_id: Schema.String,
  kind: Schema.String,
  label: Schema.NullOr(Schema.String),
  weight: Schema.Number,
  violation: Schema.Number,
  confidence: Schema.String,
  file: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Number),
});
export type EdgeRow = typeof EdgeRowSchema.Type;

export const InvariantRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  rung: Schema.String,
  severity: Schema.String,
  status: Schema.String,
  applicability_reason: Schema.NullOr(Schema.String),
  statement: Schema.String,
  violation_count: Schema.Number,
});
export type InvariantRow = typeof InvariantRowSchema.Type;

export const FilePassportRowSchema = Schema.Struct({
  file: Schema.String,
  unit: Schema.String,
  unit_id: Schema.String,
  unit_archetype: Schema.String,
  layer_policy: Schema.String,
  language: Schema.String,
  raw_layer: Schema.String,
  canonical_layer: Schema.String,
  domain_area: Schema.NullOr(Schema.String),
  layer_source: Schema.String,
  domain_source: Schema.String,
  is_test: Schema.Number,
  is_barrel: Schema.Number,
  lines: Schema.Number,
  exports_count: Schema.Number,
  prod_fan_in: Schema.Number,
  fan_out: Schema.Number,
  direct_test_importers: Schema.Number,
  active_violation_count: Schema.Number,
});
export type FilePassportRow = typeof FilePassportRowSchema.Type;

export type LookupResult<T> = { found: true; data: T } | { found: false; reason: string };

const decodeFilePassport = Schema.decodeUnknownSync(FilePassportRowSchema);

export function openRepoSpec(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });

  return {
    close(): void {
      db.close();
    },

    digest(): string {
      const row = db.query("SELECT value FROM meta WHERE key = 'specDigest'").get() as { value: string } | null;
      return row?.value ?? "";
    },

    nodes(filter?: { domain?: Domain; kind?: NodeKind; ownerId?: string }): NodeRow[] {
      const clauses: string[] = [];
      const params: string[] = [];
      if (filter?.domain) {
        clauses.push("domain = ?");
        params.push(filter.domain);
      }
      if (filter?.kind) {
        clauses.push("kind = ?");
        params.push(filter.kind);
      }
      if (filter?.ownerId) {
        clauses.push("owner_id = ?");
        params.push(filter.ownerId);
      }
      const where = clauses.length > 0 ? \`WHERE \${clauses.join(" AND ")}\` : "";
      return db.query(\`SELECT * FROM nodes \${where} ORDER BY id ASC\`).all(...params) as NodeRow[];
    },

    edges(filter?: { from?: string; to?: string; kind?: EdgeKind; violation?: boolean }): EdgeRow[] {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (filter?.from) {
        clauses.push("from_id = ?");
        params.push(filter.from);
      }
      if (filter?.to) {
        clauses.push("to_id = ?");
        params.push(filter.to);
      }
      if (filter?.kind) {
        clauses.push("kind = ?");
        params.push(filter.kind);
      }
      if (filter?.violation !== undefined) {
        clauses.push("violation = ?");
        params.push(filter.violation ? 1 : 0);
      }
      const where = clauses.length > 0 ? \`WHERE \${clauses.join(" AND ")}\` : "";
      return db.query(\`SELECT * FROM edges \${where} ORDER BY from_id ASC, kind ASC, to_id ASC\`).all(...params) as EdgeRow[];
    },

    explainFile(relFile: string): LookupResult<FilePassportRow> {
      const row = db.query("SELECT * FROM v_file_passport WHERE file = ?").get(relFile) as FilePassportRow | null;
      if (!row) return { found: false, reason: \`File "\${relFile}" not found in repospec.sqlite\` };
      return { found: true, data: decodeFilePassport(row) };
    },

    ownersOfEntity(entity: EntityName): LookupResult<{
      datastore: string;
      entity: string;
      refs: number;
      layers: string[];
      domains: string[];
    }> {
      const row = db
        .query(
          \`SELECT ea.datastore, ea.entity, COUNT(*) AS refs,
                  GROUP_CONCAT(DISTINCT ea.layer) AS layers,
                  GROUP_CONCAT(DISTINCT ea.domain_area) AS domains
           FROM entity_access ea
           JOIN v_prod_files f ON f.file = ea.file
           WHERE ea.entity = ?
           GROUP BY ea.datastore, ea.entity\`,
        )
        .get(entity as string) as {
        datastore: string;
        entity: string;
        refs: number;
        layers: string | null;
        domains: string | null;
      } | null;
      if (!row) return { found: false, reason: \`Entity "\${String(entity)}" has no production accesses\` };
      return {
        found: true,
        data: {
          datastore: row.datastore,
          entity: row.entity,
          refs: row.refs,
          layers: (row.layers ?? "").split(",").filter(Boolean).sort(),
          domains: (row.domains ?? "").split(",").filter(Boolean).sort(),
        },
      };
    },

    blastRadius(
      startId: UnitId | string,
      opts?: { kinds?: readonly EdgeKind[]; direction?: "upstream" | "downstream"; maxDepth?: number },
    ): string[] {
      const kinds = new Set<string>(opts?.kinds ?? ["depends_on", "imports_layer", "imports_domain", "routes_to", "reads_writes"]);
      const direction = opts?.direction ?? "upstream";
      const maxDepth = opts?.maxDepth ?? 3;
      const allEdges = db.query("SELECT from_id, to_id, kind FROM edges").all() as Array<{
        from_id: string;
        to_id: string;
        kind: string;
      }>;
      const visited = new Set<string>([startId as string]);
      let frontier: string[] = [startId as string];
      for (let depth = 0; depth < maxDepth; depth += 1) {
        const next: string[] = [];
        for (const cur of frontier) {
          for (const e of allEdges) {
            if (!kinds.has(e.kind)) continue;
            const neighbor = direction === "upstream" ? (e.to_id === cur ? e.from_id : null) : e.from_id === cur ? e.to_id : null;
            if (neighbor && !visited.has(neighbor)) {
              visited.add(neighbor);
              next.push(neighbor);
            }
          }
        }
        if (next.length === 0) break;
        frontier = next;
      }
      visited.delete(startId as string);
      return Array.from(visited).sort();
    },

    invariants(filter?: { status?: "pass" | "warn" | "fail" | "na"; id?: InvariantId }): InvariantRow[] {
      const clauses: string[] = [];
      const params: string[] = [];
      if (filter?.status) {
        clauses.push("status = ?");
        params.push(filter.status);
      }
      if (filter?.id) {
        clauses.push("id = ?");
        params.push(filter.id as string);
      }
      const where = clauses.length > 0 ? \`WHERE \${clauses.join(" AND ")}\` : "";
      return db.query(\`SELECT * FROM invariant_results \${where} ORDER BY id ASC\`).all(...params) as InvariantRow[];
    },

    endpoints(unit?: string): Array<{ unit: string; method: string; path: string; auth_guard: string | null; source: string; handler_file: string; line: number }> {
      if (unit) {
        return db.query("SELECT * FROM http_endpoints WHERE unit = ? ORDER BY path ASC, method ASC").all(unit) as Array<{
          unit: string;
          method: string;
          path: string;
          auth_guard: string | null;
          source: string;
          handler_file: string;
          line: number;
        }>;
      }
      return db.query("SELECT * FROM http_endpoints ORDER BY unit ASC, path ASC, method ASC").all() as Array<{
        unit: string;
        method: string;
        path: string;
        auth_guard: string | null;
        source: string;
        handler_file: string;
        line: number;
      }>;
    },

    foreignKeys(table?: string): Array<{ from_table: string; from_column: string; to_table: string; to_column: string; on_delete: string | null }> {
      if (table) {
        return db
          .query("SELECT from_table, from_column, to_table, to_column, on_delete FROM db_foreign_keys WHERE from_table = ? OR to_table = ? ORDER BY from_table ASC")
          .all(table, table) as Array<{
          from_table: string;
          from_column: string;
          to_table: string;
          to_column: string;
          on_delete: string | null;
        }>;
      }
      return db.query("SELECT from_table, from_column, to_table, to_column, on_delete FROM db_foreign_keys ORDER BY from_table ASC").all() as Array<{
        from_table: string;
        from_column: string;
        to_table: string;
        to_column: string;
        on_delete: string | null;
      }>;
    },

    envBindings(): Array<{ env_name: string; source_kind: string; unit: string; file: string; line: number; is_secret: number }> {
      return db.query("SELECT * FROM env_bindings ORDER BY env_name ASC").all() as Array<{
        env_name: string;
        source_kind: string;
        unit: string;
        file: string;
        line: number;
        is_secret: number;
      }>;
    },

    govRules(scopePath?: string): Array<{ id: string; kind: string; scope_prefix: string; symbol: string | null; text: string; rationale: string | null; file: string; line: number }> {
      if (scopePath) {
        return db
          .query("SELECT * FROM gov_rules WHERE scope_prefix = '' OR ? = scope_prefix OR ? LIKE scope_prefix || '/%' ORDER BY LENGTH(scope_prefix) DESC")
          .all(scopePath, scopePath) as Array<{
          id: string;
          kind: string;
          scope_prefix: string;
          symbol: string | null;
          text: string;
          rationale: string | null;
          file: string;
          line: number;
        }>;
      }
      return db.query("SELECT * FROM gov_rules ORDER BY kind ASC, scope_prefix ASC").all() as Array<{
        id: string;
        kind: string;
        scope_prefix: string;
        symbol: string | null;
        text: string;
        rationale: string | null;
        file: string;
        line: number;
      }>;
    },

    docDrift(): Array<{ doc_file: string; line: number; referenced_path: string }> {
      return db.query("SELECT * FROM v_doc_drift ORDER BY doc_file ASC, line ASC").all() as Array<{
        doc_file: string;
        line: number;
        referenced_path: string;
      }>;
    },
  };
}
`;
}
