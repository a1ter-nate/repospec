import { DomainSchema, EdgeKindSchema, NodeKindSchema, type RepoSpecV4 } from "./schema.ts";

function formatUnion(values: string[]): string {
  if (values.length === 0) return "never";
  return values.map((v) => JSON.stringify(v)).join(" | ");
}

function formatZodEnum(name: string, values: string[]): string {
  if (values.length === 0) {
    return `export const ${name} = z.never();`;
  }
  return `export const ${name} = z.enum([${values.map((v) => JSON.stringify(v)).join(", ")}]);`;
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

  return `import { z } from "zod";

export const REPOSPEC_SCHEMA_VERSION = ${JSON.stringify(spec.schemaVersion)} as const;
export const REPOSPEC_DIGEST = ${JSON.stringify(digest)} as const;
export const REPOSPEC_REPO = ${JSON.stringify(spec.repo.name)} as const;
export const REPOSPEC_ECOSYSTEM = ${JSON.stringify(spec.repo.ecosystem)} as const;

export type Domain = ${formatUnion([...DomainSchema.options])};
export type NodeKind = ${formatUnion([...NodeKindSchema.options])};
export type EdgeKind = ${formatUnion([...EdgeKindSchema.options])};
export type UnitId = ${formatUnion(unitIds)};
export type AppId = ${formatUnion(appIds)};
export type PackageId = ${formatUnion(pkgIds)};
export type EntityName = ${formatUnion(entityNames)};
export type InvariantId = ${formatUnion(invariantIds)};
export type StateMachineId = ${formatUnion(stateMachineIds)};

export const DomainSchema = z.enum(${JSON.stringify([...DomainSchema.options])});
export const NodeKindSchema = z.enum(${JSON.stringify([...NodeKindSchema.options])});
export const EdgeKindSchema = z.enum(${JSON.stringify([...EdgeKindSchema.options])});
${formatZodEnum("UnitIdSchema", unitIds)}
${formatZodEnum("AppIdSchema", appIds)}
${formatZodEnum("PackageIdSchema", pkgIds)}
${formatZodEnum("EntityNameSchema", entityNames)}
${formatZodEnum("InvariantIdSchema", invariantIds)}
${formatZodEnum("StateMachineIdSchema", stateMachineIds)}
`;
}

export function generateSqliteSdkModule(): string {
  return `import { Database } from "bun:sqlite";
import { z } from "zod";
import type { Domain, EdgeKind, EntityName, InvariantId, NodeKind, UnitId } from "./repospec.ids.ts";

export const REPOSPEC_SDK_RUNTIME = "bun:sqlite" as const;

export const NodeRowSchema = z.object({
  id: z.string(),
  domain: z.string(),
  kind: z.string(),
  role: z.string().nullable(),
  label: z.string(),
  grp: z.string().nullable(),
  owner_id: z.string().nullable(),
  file: z.string(),
  line: z.number().nullable(),
});
export type NodeRow = z.infer<typeof NodeRowSchema>;

export const EdgeRowSchema = z.object({
  from_id: z.string(),
  to_id: z.string(),
  kind: z.string(),
  label: z.string().nullable(),
  weight: z.number(),
  violation: z.number(),
  confidence: z.string(),
  file: z.string().nullable(),
  line: z.number().nullable(),
});
export type EdgeRow = z.infer<typeof EdgeRowSchema>;

export const InvariantRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  rung: z.string(),
  severity: z.string(),
  status: z.string(),
  applicability_reason: z.string().nullable(),
  statement: z.string(),
  violation_count: z.number(),
});
export type InvariantRow = z.infer<typeof InvariantRowSchema>;

export const FilePassportRowSchema = z.object({
  file: z.string(),
  unit: z.string(),
  unit_id: z.string(),
  unit_archetype: z.string(),
  layer_policy: z.string(),
  language: z.string(),
  raw_layer: z.string(),
  canonical_layer: z.string(),
  domain_area: z.string().nullable(),
  layer_source: z.string(),
  domain_source: z.string(),
  is_test: z.number(),
  is_barrel: z.number(),
  lines: z.number(),
  exports_count: z.number(),
  prod_fan_in: z.number(),
  fan_out: z.number(),
  direct_test_importers: z.number(),
  active_violation_count: z.number(),
});
export type FilePassportRow = z.infer<typeof FilePassportRowSchema>;

export type LookupResult<T> = { found: true; data: T } | { found: false; reason: string };

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
      return { found: true, data: FilePassportRowSchema.parse(row) };
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
