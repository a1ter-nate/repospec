import { createHash } from "node:crypto";
import type { FactRecord, RepoSpecV4 } from "./schema.ts";

export interface FactDiffResult {
  readonly kind?: string;
  readonly added: FactRecord[];
  readonly removed: FactRecord[];
  readonly unchangedCount: number;
}

export function hashSpec(spec: RepoSpecV4): string {
  const semanticProjection = {
    schemaVersion: spec.schemaVersion,
    repo: spec.repo,
    nodes: spec.nodes,
    edges: spec.edges,
    rules: spec.rules,
    invariants: spec.invariants.map((inv) => ({
      ...inv,
      evidence: inv.evidence.map(({ anchors: _anchors, ...rest }) => rest),
    })),
    entities: spec.entities,
    stateMachines: spec.stateMachines,
    loops: spec.loops,
    catalogArtifacts: spec.catalogArtifacts,
    modules: spec.modules,
    verification: spec.verification,
    diagnostics: spec.diagnostics,
  };
  return createHash("sha256").update(JSON.stringify(semanticProjection)).digest("hex");
}

function factIdentity(f: FactRecord): string {
  return `${f.kind}|${f.key}|${f.file}`;
}

export function diffFactSets(
  baseFacts: readonly FactRecord[],
  headFacts: readonly FactRecord[],
  kind?: string,
): FactDiffResult {
  const baseFiltered = kind ? baseFacts.filter((f) => f.kind === kind) : baseFacts;
  const headFiltered = kind ? headFacts.filter((f) => f.kind === kind) : headFacts;
  const baseMap = new Map(baseFiltered.map((f) => [factIdentity(f), f]));
  const headMap = new Map(headFiltered.map((f) => [factIdentity(f), f]));
  const added: FactRecord[] = [];
  const removed: FactRecord[] = [];
  let unchangedCount = 0;
  for (const [k, f] of headMap) {
    if (baseMap.has(k)) unchangedCount += 1;
    else added.push(f);
  }
  for (const [k, f] of baseMap) {
    if (!headMap.has(k)) removed.push(f);
  }
  return { kind, added, removed, unchangedCount };
}

const NON_SECRET_ENV_SUFFIX_RE =
  /(?:_PORT|_SERVICE|_URL|_URI|_HOST|_HOSTNAME|_ADDR|_ADDRESS|_DIR|_PATH|_FILE|_ENABLED|_DISABLE|_DISABLED|_TIMEOUT|_TIMEOUT_MS|_TTL|_MODE|_ENV|_REGION|_PROJECT|_BUCKET|_NAMESPACE|_PREFIX|_VERSION|_COUNT|_MAX|_MIN|_LIMIT|_INTERVAL)$/i;
const SECRET_ENV_TOKEN_RE =
  /(?:SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|SIGNING_?KEY|ENCRYPTION_?KEY|PASSWORD|PASSWD|CREDENTIAL|CONNECTION_?STRING|DATABASE_URL|AUTH_?KEY|CLIENT_SECRET|MASTER_KEY|JWT_KEY|HMAC_KEY)$/i;

export function isSecretEnvName(envName: string): boolean {
  const name = envName.trim();
  if (/^(?:DATABASE_URL|CONNECTION_?STRING|PGPASSWORD|REDIS_URL|MONGO_?URI)$/i.test(name)) return true;
  if (NON_SECRET_ENV_SUFFIX_RE.test(name)) return false;
  return SECRET_ENV_TOKEN_RE.test(name);
}
