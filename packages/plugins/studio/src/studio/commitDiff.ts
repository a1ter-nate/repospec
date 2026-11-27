import { execFileSync } from "node:child_process";
import { extractUnifiedDiffHunks } from "../gitMetrics.ts";
import type { RepoSpecV4 } from "@repospec/plugin";
import { buildOverlayBundle, type DiffDiagramBundle } from "./diffOverlay.ts";

export interface ChangedFileEntry {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  insertions: number;
  deletions: number;
  unitSlug: string;
  moduleId: string | null;
  blastRadius: number;
  hunk?: string;
}

export interface FindingDeltaItem {
  invariantId: string;
  invariantName: string;
  severity: "error" | "warn";
  subject: string;
  detail: string;
  file: string;
  line?: number;
  fix?: string;
}

export interface CommitArchDiff {
  range: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  commitSubject: string;
  author: string;
  date: string;
  commitCount: number;
  verdict: "safe" | "caution" | "risk";
  verdictSummary: string;
  kpis: {
    failures: { before: number; after: number; delta: number };
    warnings: { before: number; after: number; delta: number };
    coveragePct: { before: number; after: number; delta: number };
    files: { added: number; modified: number; deleted: number; insertions: number; deletions: number };
    nodes: { added: number; modified: number; removed: number };
    edges: { added: number; removed: number };
  };
  surfaces: {
    endpointsAdded: string[];
    endpointsRemoved: string[];
    externalAdded: string[];
    externalRemoved: string[];
    envAdded: string[];
    envRemoved: string[];
    entitiesAdded: string[];
    entitiesRemoved: string[];
  };
  findings: {
    introduced: FindingDeltaItem[];
    resolved: FindingDeltaItem[];
    persistentCount: number;
  };
  edgeChanges: {
    added: Array<{ from: string; to: string; kind: string }>;
    removed: Array<{ from: string; to: string; kind: string }>;
  };
  changedFiles: ChangedFileEntry[];
  diagrams: DiffDiagramBundle[];
}

function runGit(repoDir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
}

export function resolveGitDiffRange(repoDir: string, rangeArg?: string): {
  range: string;
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  commitSubject: string;
  author: string;
  date: string;
  commitCount: number;
  fileStats: Array<{ path: string; status: ChangedFileEntry["status"]; insertions: number; deletions: number }>;
  hunksByPath: Map<string, string>;
} {
  let baseRef = "HEAD~1";
  let headRef = "HEAD";
  if (rangeArg && rangeArg.trim().length > 0) {
    const clean = rangeArg.trim();
    if (clean.includes("...")) {
      const [b, h] = clean.split("...");
      baseRef = b || "HEAD~1";
      headRef = h || "HEAD";
    } else if (clean.includes("..")) {
      const [b, h] = clean.split("..");
      baseRef = b || "HEAD~1";
      headRef = h || "HEAD";
    } else {
      baseRef = `${clean}~1`;
      headRef = clean;
    }
  }

  const baseSha = runGit(repoDir, ["rev-parse", "--short=7", baseRef]);
  const isWorktree = headRef === "WORKTREE";
  const headSha = isWorktree ? "WORKTREE" : runGit(repoDir, ["rev-parse", "--short=7", headRef]);
  const commitSubject = isWorktree
    ? "Working tree changes"
    : runGit(repoDir, ["log", "-1", "--pretty=%s", headRef]);
  const author = isWorktree
    ? "Local workspace"
    : runGit(repoDir, ["log", "-1", "--pretty=%an", headRef]);
  const date = isWorktree
    ? new Date().toISOString().slice(0, 10)
    : runGit(repoDir, ["log", "-1", "--pretty=%cs", headRef]);
  const countStr = isWorktree ? "1" : runGit(repoDir, ["rev-list", "--count", `${baseRef}..${headRef}`]);
  const commitCount = Math.max(1, Number.parseInt(countStr, 10) || 1);

  const diffArgs = isWorktree ? ["diff", "--numstat", baseRef] : ["diff", "--numstat", baseRef, headRef];
  const statusArgs = isWorktree ? ["diff", "--name-status", baseRef] : ["diff", "--name-status", baseRef, headRef];
  const numstatOut = runGit(repoDir, diffArgs);
  const statusOut = runGit(repoDir, statusArgs);

  const statusByPath = new Map<string, ChangedFileEntry["status"]>();
  for (const line of statusOut.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0]?.[0] ?? "M";
    const filePath = parts[parts.length - 1] ?? "";
    if (!filePath) continue;
    const st: ChangedFileEntry["status"] =
      code === "A" ? "added" : code === "D" ? "deleted" : code === "R" ? "renamed" : "modified";
    statusByPath.set(filePath, st);
  }

  const fileStats: Array<{ path: string; status: ChangedFileEntry["status"]; insertions: number; deletions: number }> = [];
  for (const line of numstatOut.split("\n")) {
    if (!line.trim()) continue;
    const [insRaw, delRaw, ...rest] = line.split("\t");
    const filePath = rest.join("\t").replace(/\{[^}]* => ([^}]*)\}/g, "$1").replace(/^.* => /, "");
    if (!filePath) continue;
    fileStats.push({
      path: filePath,
      status: statusByPath.get(filePath) ?? "modified",
      insertions: Number.parseInt(insRaw ?? "0", 10) || 0,
      deletions: Number.parseInt(delRaw ?? "0", 10) || 0,
    });
  }

  const hunksByPath = extractUnifiedDiffHunks(repoDir, baseRef, headRef);
  return {
    range: `${baseRef}..${headRef}`,
    baseRef,
    headRef,
    baseSha,
    headSha,
    commitSubject,
    author,
    date,
    commitCount,
    fileStats,
    hunksByPath,
  };
}

function setDiff(baseItems: string[], headItems: string[]): { added: string[]; removed: string[] } {
  const bSet = new Set(baseItems);
  const hSet = new Set(headItems);
  return {
    added: headItems.filter((x) => !bSet.has(x)).sort(),
    removed: baseItems.filter((x) => !hSet.has(x)).sort(),
  };
}

export function buildCommitArchDiff(params: {
  git: Omit<ReturnType<typeof resolveGitDiffRange>, "hunksByPath"> & { hunksByPath?: Map<string, string> };
  baseSpec: RepoSpecV4;
  headSpec: RepoSpecV4;
}): CommitArchDiff {
  const { git, baseSpec, headSpec } = params;

  const baseInvMap = new Map<string, FindingDeltaItem>();
  const headInvMap = new Map<string, FindingDeltaItem>();
  for (const inv of baseSpec.invariants) {
    if (inv.status !== "fail" && inv.status !== "warn") continue;
    for (const ev of inv.evidence) {
      const key = `${inv.id}|${ev.file}|${ev.subject}`;
      baseInvMap.set(key, {
        invariantId: inv.id,
        invariantName: inv.name,
        severity: inv.status === "fail" ? "error" : "warn",
        subject: ev.subject,
        detail: ev.detail,
        file: ev.file,
        line: ev.line,
        fix: inv.fix,
      });
    }
  }
  for (const inv of headSpec.invariants) {
    if (inv.status !== "fail" && inv.status !== "warn") continue;
    for (const ev of inv.evidence) {
      const key = `${inv.id}|${ev.file}|${ev.subject}`;
      headInvMap.set(key, {
        invariantId: inv.id,
        invariantName: inv.name,
        severity: inv.status === "fail" ? "error" : "warn",
        subject: ev.subject,
        detail: ev.detail,
        file: ev.file,
        line: ev.line,
        fix: inv.fix,
      });
    }
  }

  const introduced: FindingDeltaItem[] = [];
  const resolved: FindingDeltaItem[] = [];
  let persistentCount = 0;
  for (const [k, item] of headInvMap) {
    if (baseInvMap.has(k)) persistentCount += 1;
    else introduced.push(item);
  }
  for (const [k, item] of baseInvMap) {
    if (!headInvMap.has(k)) resolved.push(item);
  }
  introduced.sort((a, b) => (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1) || a.file.localeCompare(b.file));
  resolved.sort((a, b) => (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1) || a.file.localeCompare(b.file));

  const epDiff = setDiff(
    baseSpec.surfaces.endpoints.map((e) => `${e.method} ${e.path}`),
    headSpec.surfaces.endpoints.map((e) => `${e.method} ${e.path}`),
  );
  const extDiff = setDiff(
    baseSpec.nodes.filter((n) => n.kind === "external_service").map((n) => n.label),
    headSpec.nodes.filter((n) => n.kind === "external_service").map((n) => n.label),
  );
  const envDiff = setDiff(
    baseSpec.surfaces.envBindings.map((e) => e.name),
    headSpec.surfaces.envBindings.map((e) => e.name),
  );
  const entDiff = setDiff(
    baseSpec.entities.map((e) => `${e.datastore}:${e.entity}`),
    headSpec.entities.map((e) => `${e.datastore}:${e.entity}`),
  );

  const headUnits = headSpec.nodes.filter((n) => n.kind === "app" || n.kind === "package" || n.kind === "native_app");
  const headMods = headSpec.modules ?? [];
  const modifiedNodeIds = new Set<string>();
  const deltaByNodeId = new Map<string, string>();
  const unitStatsAcc = new Map<string, { ins: number; del: number }>();
  const modStatsAcc = new Map<string, { ins: number; del: number }>();

  const changedFiles: ChangedFileEntry[] = git.fileStats.map((fsItem) => {
    const matchedMod = headMods.find(
      (m) =>
        m.files.some((mf) => mf.file === fsItem.path) ||
        fsItem.path === m.relPath ||
        fsItem.path.startsWith(`${m.relPath}/`),
    );
    let unitSlug = matchedMod?.unitSlug ?? "";
    let unitId = matchedMod?.unitId ?? "";
    if (!unitSlug) {
      const matchedUnit = headUnits.find((u) => {
        const dir = typeof u.meta.dir === "string" ? u.meta.dir : "";
        return dir && (fsItem.path === dir || fsItem.path.startsWith(`${dir}/`));
      });
      if (matchedUnit) {
        unitId = matchedUnit.id;
        unitSlug = matchedUnit.label.replace(/^@[^/]+\//, "");
      }
    }
    if (unitId) {
      modifiedNodeIds.add(unitId);
      const cur = unitStatsAcc.get(unitId) ?? { ins: 0, del: 0 };
      cur.ins += fsItem.insertions;
      cur.del += fsItem.deletions;
      unitStatsAcc.set(unitId, cur);
    }
    if (matchedMod) {
      modifiedNodeIds.add(matchedMod.id);
      const cur = modStatsAcc.get(matchedMod.id) ?? { ins: 0, del: 0 };
      cur.ins += fsItem.insertions;
      cur.del += fsItem.deletions;
      modStatsAcc.set(matchedMod.id, cur);
    }
    const hunk = git.hunksByPath?.get(fsItem.path);
    return {
      path: fsItem.path,
      status: fsItem.status,
      insertions: fsItem.insertions,
      deletions: fsItem.deletions,
      unitSlug: unitSlug || "repo",
      moduleId: matchedMod?.id ?? null,
      blastRadius: matchedMod?.fanIn ?? 0,
      hunk,
    };
  });

  for (const [id, st] of [...unitStatsAcc.entries(), ...modStatsAcc.entries()]) {
    deltaByNodeId.set(id, `+${st.ins}/-${st.del}`);
  }

  const baseDiagById = new Map(baseSpec.diagrams.map((d) => [d.id, d]));
  const headDiagById = new Map(headSpec.diagrams.map((d) => [d.id, d]));
  const diagrams: DiffDiagramBundle[] = [];

  const runtimeBundle = buildOverlayBundle(
    "diff:runtime",
    "System Runtime",
    baseDiagById.get("runtime") ?? null,
    headDiagById.get("runtime") ?? null,
    modifiedNodeIds,
    deltaByNodeId,
  );
  if (runtimeBundle) diagrams.push(runtimeBundle);

  const unitDiagIds = new Set<string>([
    ...headSpec.diagrams.filter((d) => d.category === "modules").map((d) => d.id),
    ...baseSpec.diagrams.filter((d) => d.category === "modules").map((d) => d.id),
  ]);
  for (const did of unitDiagIds) {
    const slug = did.replace(/^modules:/, "");
    const bundle = buildOverlayBundle(
      `diff:${did}`,
      `${slug} Modules`,
      baseDiagById.get(did) ?? null,
      headDiagById.get(did) ?? null,
      modifiedNodeIds,
      deltaByNodeId,
    );
    if (bundle && (bundle.changedCount > 0 || diagrams.length <= 1)) {
      diagrams.push(bundle);
    }
  }
  diagrams.sort((a, b) => {
    if (a.id === "diff:runtime" && b.id !== "diff:runtime") return b.changedCount > 0 && a.changedCount === 0 ? 1 : -1;
    if (b.id === "diff:runtime" && a.id !== "diff:runtime") return a.changedCount > 0 && b.changedCount === 0 ? -1 : 1;
    return b.changedCount - a.changedCount;
  });
  const runtimeIdx = diagrams.findIndex((d) => d.id === "diff:runtime");
  if (runtimeIdx > 5) {
    const [rt] = diagrams.splice(runtimeIdx, 1);
    if (rt) diagrams.splice(1, 0, rt);
  }

  const baseEdges = new Map(baseSpec.edges.map((e) => [`${e.from}|${e.to}|${e.kind}`, e]));
  const headEdges = new Map(headSpec.edges.map((e) => [`${e.from}|${e.to}|${e.kind}`, e]));
  const nodeName = (id: string) =>
    headSpec.nodes.find((n) => n.id === id)?.label ?? baseSpec.nodes.find((n) => n.id === id)?.label ?? id;
  const addedEdges = Array.from(headEdges.entries())
    .filter(([k]) => !baseEdges.has(k))
    .map(([, e]) => ({ from: nodeName(e.from), to: nodeName(e.to), kind: e.kind }))
    .slice(0, 40);
  const removedEdges = Array.from(baseEdges.entries())
    .filter(([k]) => !headEdges.has(k))
    .map(([, e]) => ({ from: nodeName(e.from), to: nodeName(e.to), kind: e.kind }))
    .slice(0, 40);

  const primaryOverlay = diagrams[0]?.overlay;
  const nodesAdded = primaryOverlay ? primaryOverlay.nodes.filter((n) => n.diffStatus === "added").length : 0;
  const nodesModified = primaryOverlay ? primaryOverlay.nodes.filter((n) => n.diffStatus === "modified").length : 0;
  const nodesRemoved = primaryOverlay ? primaryOverlay.nodes.filter((n) => n.diffStatus === "removed").length : 0;

  const newErrors = introduced.filter((f) => f.severity === "error").length;
  const newWarns = introduced.filter((f) => f.severity === "warn").length;
  const covDelta = Math.round((headSpec.verification.directTestCoveragePct - baseSpec.verification.directTestCoveragePct) * 10) / 10;

  const verdict: CommitArchDiff["verdict"] =
    newErrors > 0 ? "risk" : newWarns > 0 || extDiff.added.length > 0 || covDelta <= -1.0 ? "caution" : "safe";

  const summaryParts: string[] = [];
  if (newErrors > 0) summaryParts.push(`introduces ${newErrors} new invariant failure${newErrors === 1 ? "" : "s"}`);
  else if (newWarns > 0) summaryParts.push(`adds ${newWarns} new warning${newWarns === 1 ? "" : "s"}`);
  else summaryParts.push("introduces 0 new architectural violations");
  if (resolved.length > 0) summaryParts.push(`resolves ${resolved.length} existing finding${resolved.length === 1 ? "" : "s"}`);
  summaryParts.push(`touches ${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"} (+${changedFiles.reduce((s, f) => s + f.insertions, 0)}/-${changedFiles.reduce((s, f) => s + f.deletions, 0)})`);

  return {
    range: git.range,
    baseRef: git.baseRef,
    headRef: git.headRef,
    baseSha: git.baseSha,
    headSha: git.headSha,
    commitSubject: git.commitSubject,
    author: git.author,
    date: git.date,
    commitCount: git.commitCount,
    verdict,
    verdictSummary: `This change ${summaryParts.join(", ")}.`,
    kpis: {
      failures: {
        before: baseSpec.verification.invariantsFailed,
        after: headSpec.verification.invariantsFailed,
        delta: headSpec.verification.invariantsFailed - baseSpec.verification.invariantsFailed,
      },
      warnings: {
        before: baseSpec.verification.invariantsWarned,
        after: headSpec.verification.invariantsWarned,
        delta: headSpec.verification.invariantsWarned - baseSpec.verification.invariantsWarned,
      },
      coveragePct: {
        before: baseSpec.verification.directTestCoveragePct,
        after: headSpec.verification.directTestCoveragePct,
        delta: covDelta,
      },
      files: {
        added: changedFiles.filter((f) => f.status === "added").length,
        modified: changedFiles.filter((f) => f.status === "modified" || f.status === "renamed").length,
        deleted: changedFiles.filter((f) => f.status === "deleted").length,
        insertions: changedFiles.reduce((s, f) => s + f.insertions, 0),
        deletions: changedFiles.reduce((s, f) => s + f.deletions, 0),
      },
      nodes: { added: nodesAdded, modified: nodesModified, removed: nodesRemoved },
      edges: { added: addedEdges.length, removed: removedEdges.length },
    },
    surfaces: {
      endpointsAdded: epDiff.added.slice(0, 30),
      endpointsRemoved: epDiff.removed.slice(0, 30),
      externalAdded: extDiff.added,
      externalRemoved: extDiff.removed,
      envAdded: envDiff.added.slice(0, 30),
      envRemoved: envDiff.removed.slice(0, 30),
      entitiesAdded: entDiff.added.slice(0, 30),
      entitiesRemoved: entDiff.removed.slice(0, 30),
    },
    findings: {
      introduced,
      resolved,
      persistentCount,
    },
    edgeChanges: {
      added: addedEdges,
      removed: removedEdges,
    },
    changedFiles: changedFiles.slice(0, 200),
    diagrams,
  };
}
