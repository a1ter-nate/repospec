import type { RepoSpecV4 } from "../../schema.ts";
import type { DrilldownIndex } from "../../studio/drilldown.ts";

export const FIX_NEXT_HIT_LIMIT = 12;

export type CheckTier = "broken" | "fix_next" | "patterns" | "housekeeping" | "holding";

export interface CheckJumpTarget {
  kind: "map" | "flows" | "surfaces_config" | "surfaces_data" | "matrix";
  label: string;
  flowId?: string | null;
  file?: string | null;
}

export interface CheckFileGroup {
  file: string;
  unit: string;
  count: number;
  lines: number[];
  items: Array<{ line: number; subject: string; detail: string }>;
}

export interface CheckUnitGroup {
  unit: string;
  count: number;
  files: CheckFileGroup[];
}

export interface CheckItemModel {
  id: string;
  name: string;
  status: "fail" | "warn" | "pass" | "na";
  severity: "error" | "warn" | "info";
  rung: string;
  tier: CheckTier;
  violationCount: number;
  loadedCount: number;
  statement: string;
  why: string;
  fix: string;
  applicabilityReason: string | null;
  wherePreview: string;
  unitSummary: string;
  unitGroups: CheckUnitGroup[];
  fileGroups: CheckFileGroup[];
  jumpTarget: CheckJumpTarget | null;
  isEnvDrift: boolean;
}

export interface CheckPlaceFinding {
  checkId: string;
  checkName: string;
  tier: CheckTier;
  line: number;
  subject: string;
  detail: string;
  fix: string;
}

export interface CheckPlaceModel {
  file: string;
  baseName: string;
  unit: string;
  hasSource: boolean;
  checkCount: number;
  hitCount: number;
  hasBroken: boolean;
  findings: CheckPlaceFinding[];
}

export interface ChecksModel {
  verdict: string;
  counts: {
    broken: number;
    brokenHits: number;
    fixNext: number;
    fixNextHits: number;
    patterns: number;
    patternHits: number;
    housekeeping: number;
    housekeepingHits: number;
    passed: number;
    na: number;
  };
  items: CheckItemModel[];
  places: CheckPlaceModel[];
  defaultCheckId: string | null;
}

export interface ChecksSpecInput {
  invariants: RepoSpecV4["invariants"];
}

export function classifyCheckTier(inv: {
  status: "fail" | "warn" | "pass" | "na";
  severity: "error" | "warn" | "info";
  violationCount: number;
}): CheckTier {
  if (inv.status === "fail") return "broken";
  if (inv.status === "pass" || inv.status === "na") return "holding";
  if (inv.severity === "info") return "housekeeping";
  return inv.violationCount <= FIX_NEXT_HIT_LIMIT ? "fix_next" : "patterns";
}

function unitFromFile(file: string): string {
  const parts = file.split("/").filter(Boolean);
  if (parts.length >= 2 && (parts[0] === "apps" || parts[0] === "packages" || parts[0] === "services" || parts[0] === "crates" || parts[0] === "infra" || parts[0] === "tools")) {
    return parts[0] + "/" + parts[1];
  }
  return parts[0] ?? "repo";
}

function buildWherePreview(ev: RepoSpecV4["invariants"][number]["evidence"]): string {
  const seen = new Set<string>();
  const chips: string[] = [];
  for (const item of ev) {
    if (!item.file || item.file === ".") continue;
    const base = item.file.split("/").pop() ?? item.file;
    const tag = item.line ? base + ":" + item.line : base;
    if (seen.has(tag)) continue;
    seen.add(tag);
    chips.push(tag);
    if (chips.length >= 2) break;
  }
  const uniqueFiles = new Set(ev.map((e) => e.file).filter((f) => f && f !== ".")).size;
  if (chips.length === 0) return "";
  if (uniqueFiles > chips.length) return chips.join(" · ") + " +" + (uniqueFiles - chips.length);
  return chips.join(" · ");
}

function inferJumpTarget(
  inv: RepoSpecV4["invariants"][number],
  flowByFile: Map<string, string>,
): CheckJumpTarget | null {
  const hasAnchor = inv.evidence.some((e) => e.anchors && e.anchors.length > 0);
  if (inv.id.includes("env-contract")) return { kind: "surfaces_config", label: "Open in Config" };
  if (inv.id.startsWith("ddia:")) {
    const matched = inv.evidence.find((e) => flowByFile.has(e.file));
    return {
      kind: "flows",
      label: "Open in Flows",
      flowId: matched ? (flowByFile.get(matched.file) ?? null) : null,
      file: inv.evidence[0]?.file ?? null,
    };
  }
  if (hasAnchor) return { kind: "map", label: "Show on map" };
  if (inv.id.includes("entity") || inv.id.includes("collection")) {
    return { kind: "surfaces_data", label: "Open in Data" };
  }
  if (inv.id.includes("tangle") || inv.id.includes("cycle") || inv.id.includes("coupling")) {
    return { kind: "matrix", label: "Open matrix" };
  }
  return null;
}

function buildVerdict(c: ChecksModel["counts"]): string {
  const parts: string[] = [];
  if (c.broken > 0) {
    parts.push(
      c.broken + " rule" + (c.broken === 1 ? "" : "s") + " broken in " + c.brokenHits + " place" + (c.brokenHits === 1 ? "" : "s") + ".",
    );
  }
  if (c.fixNext > 0) {
    parts.push(c.fixNext + " small fix" + (c.fixNext === 1 ? "" : "es") + ".");
  }
  const later: string[] = [];
  if (c.patterns > 0) later.push(c.patterns + " pattern" + (c.patterns === 1 ? "" : "s"));
  if (c.housekeeping > 0) later.push(c.housekeeping + " chore" + (c.housekeeping === 1 ? "" : "s"));
  if (later.length > 0) parts.push(later.join(" and ") + " can wait.");
  if (parts.length === 0) {
    return "All " + c.passed + " applicable architectural guardrails hold.";
  }
  return parts.join(" ");
}

export function buildChecksModel(
  spec: ChecksSpecInput,
  workFlows: readonly { id: string; file: string }[],
  drilldown?: { files: readonly Pick<DrilldownIndex["files"][number], "p">[] },
): ChecksModel {
  const indexedFiles = new Set((drilldown?.files ?? []).map((f) => f.p));
  const flowByFile = new Map<string, string>();
  for (const wf of workFlows) {
    if (wf.file && !flowByFile.has(wf.file)) flowByFile.set(wf.file, wf.id);
  }

  const placeMap = new Map<
    string,
    {
      file: string;
      unit: string;
      checkIds: Set<string>;
      hasBroken: boolean;
      findings: CheckPlaceFinding[];
    }
  >();

  const items: CheckItemModel[] = spec.invariants.map((inv) => {
    const tier = classifyCheckTier(inv);
    const fileMap = new Map<string, CheckFileGroup>();
    const unitMap = new Map<string, { unit: string; count: number; files: Map<string, CheckFileGroup> }>();
    for (const ev of inv.evidence) {
      const f = ev.file || ".";
      const u = unitFromFile(f);
      const fg = fileMap.get(f) ?? { file: f, unit: u, count: 0, lines: [], items: [] };
      fg.count += 1;
      if (ev.line) fg.lines.push(ev.line);
      fg.items.push({ line: ev.line ?? 0, subject: ev.subject || "", detail: ev.detail || "" });
      fileMap.set(f, fg);

      const ug = unitMap.get(u) ?? { unit: u, count: 0, files: new Map<string, CheckFileGroup>() };
      ug.count += 1;
      ug.files.set(f, fg);
      unitMap.set(u, ug);

      if ((inv.status === "fail" || inv.status === "warn") && f !== ".") {
        const pm = placeMap.get(f) ?? {
          file: f,
          unit: u,
          checkIds: new Set<string>(),
          hasBroken: false,
          findings: [],
        };
        pm.checkIds.add(inv.id);
        if (tier === "broken") pm.hasBroken = true;
        pm.findings.push({
          checkId: inv.id,
          checkName: inv.name,
          tier,
          line: ev.line ?? 0,
          subject: ev.subject || "",
          detail: ev.detail || "",
          fix: inv.fix || "",
        });
        placeMap.set(f, pm);
      }
    }

    const fileGroups = Array.from(fileMap.values()).sort((a, b) =>
      b.count !== a.count ? b.count - a.count : a.file.localeCompare(b.file),
    );
    const unitGroups: CheckUnitGroup[] = Array.from(unitMap.values())
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.unit.localeCompare(b.unit)))
      .map((u) => ({
        unit: u.unit,
        count: u.count,
        files: Array.from(u.files.values()).sort((a, b) =>
          b.count !== a.count ? b.count - a.count : a.file.localeCompare(b.file),
        ),
      }));

    const unitSummary =
      unitGroups.length === 0
        ? ""
        : unitGroups.length === 1
          ? "all in " + unitGroups[0]?.unit
          : unitGroups.length + " units (" + unitGroups.slice(0, 2).map((u) => u.unit).join(", ") + ")";

    return {
      id: inv.id,
      name: inv.name,
      status: inv.status,
      severity: inv.severity,
      rung: inv.rung,
      tier,
      violationCount: inv.violationCount,
      loadedCount: inv.evidence.length,
      statement: inv.statement,
      why: inv.why ?? "",
      fix: inv.fix ?? "",
      applicabilityReason: inv.applicabilityReason ?? null,
      wherePreview: buildWherePreview(inv.evidence),
      unitSummary,
      unitGroups,
      fileGroups,
      jumpTarget: inv.status === "fail" || inv.status === "warn" ? inferJumpTarget(inv, flowByFile) : null,
      isEnvDrift: inv.id.includes("env-contract"),
    };
  });

  const tierRank: Record<CheckTier, number> = {
    broken: 0,
    fix_next: 1,
    patterns: 2,
    housekeeping: 3,
    holding: 4,
  };
  items.sort((a, b) => {
    const tr = tierRank[a.tier] - tierRank[b.tier];
    if (tr !== 0) return tr;
    if (a.tier === "patterns") return b.violationCount - a.violationCount || a.name.localeCompare(b.name);
    return a.violationCount - b.violationCount || a.name.localeCompare(b.name);
  });

  const places: CheckPlaceModel[] = Array.from(placeMap.values())
    .filter((p) => p.checkIds.size >= 2)
    .map((p) => ({
      file: p.file,
      baseName: p.file.split("/").pop() ?? p.file,
      unit: p.unit,
      hasSource: indexedFiles.has(p.file),
      checkCount: p.checkIds.size,
      hitCount: p.findings.length,
      hasBroken: p.hasBroken,
      findings: p.findings.sort((a, b) => (a.line || 999999) - (b.line || 999999) || a.checkName.localeCompare(b.checkName)),
    }))
    .sort((a, b) => (b.hasBroken ? 1 : 0) - (a.hasBroken ? 1 : 0) || b.checkCount - a.checkCount || b.hitCount - a.hitCount || a.file.localeCompare(b.file));

  const counts: ChecksModel["counts"] = {
    broken: items.filter((i) => i.tier === "broken").length,
    brokenHits: items.filter((i) => i.tier === "broken").reduce((s, i) => s + i.violationCount, 0),
    fixNext: items.filter((i) => i.tier === "fix_next").length,
    fixNextHits: items.filter((i) => i.tier === "fix_next").reduce((s, i) => s + i.violationCount, 0),
    patterns: items.filter((i) => i.tier === "patterns").length,
    patternHits: items.filter((i) => i.tier === "patterns").reduce((s, i) => s + i.violationCount, 0),
    housekeeping: items.filter((i) => i.tier === "housekeeping").length,
    housekeepingHits: items.filter((i) => i.tier === "housekeeping").reduce((s, i) => s + i.violationCount, 0),
    passed: items.filter((i) => i.status === "pass").length,
    na: items.filter((i) => i.status === "na").length,
  };

  const firstActive = items.find((i) => i.tier !== "holding") ?? items[0] ?? null;

  return {
    verdict: buildVerdict(counts),
    counts,
    items,
    places,
    defaultCheckId: firstActive?.id ?? null,
  };
}
