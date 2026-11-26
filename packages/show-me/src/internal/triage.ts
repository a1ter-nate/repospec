import path from "node:path";
import type { CommitArchDiff } from "../../../../src/studio/commitDiff.ts";
import { parseIacDiff, type IacBlockDelta } from "./fileClass.ts";
import type { RankedChangedFile, RankedDiagram } from "./ranking.ts";

export type ReviewLevel = "scrutinize" | "look" | "skim";
export type PrArchetype =
  | "violation"
  | "wiring"
  | "multi_unit"
  | "iac_sensitive"
  | "symbol"
  | "surface"
  | "no_structure";

export interface AttentionItem {
  kind: "violation" | "contract" | "sensitive" | "untested" | "tangle" | "external";
  title: string;
  detail: string;
}

export interface TriageResult {
  level: ReviewLevel;
  archetype: PrArchetype;
  headline: string;
  shapeLine: string;
  attentionItems: AttentionItem[];
  iacDelta: IacBlockDelta;
  testedInPrCount: number;
  testsAddedLoc: number;
}

function summarizeWiringHeadline(diagram: RankedDiagram): string {
  const nodes = diagram.overlay.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const addedNodes = nodes.filter((n) => n.diffStatus === "added");
  const addedEdges = diagram.overlay.edges.filter((e) => e.diffStatus === "added");
  const removedEdges = diagram.overlay.edges.filter((e) => e.diffStatus === "removed");

  const firstNew = addedNodes[0];
  if (firstNew) {
    const incoming = addedEdges.find((e) => e.to === firstNew.id);
    const outgoing = addedEdges.find((e) => e.from === firstNew.id);
    const fromLabel = incoming ? byId.get(incoming.from)?.label : undefined;
    const toLabel = outgoing ? byId.get(outgoing.to)?.label : undefined;
    if (fromLabel && toLabel) {
      return `New module \`${firstNew.label}\` wired between \`${fromLabel}\` → \`${toLabel}\``;
    }
    if (fromLabel) return `New module \`${firstNew.label}\` wired from \`${fromLabel}\``;
    if (toLabel) return `New module \`${firstNew.label}\` wired to \`${toLabel}\``;
    return `Added module \`${firstNew.label}\` in \`${diagram.bundle.label}\``;
  }
  const firstAddedEdge = addedEdges[0];
  if (firstAddedEdge) {
    const a = byId.get(firstAddedEdge.from)?.label ?? firstAddedEdge.from;
    const b = byId.get(firstAddedEdge.to)?.label ?? firstAddedEdge.to;
    return `\`${a}\` now depends on \`${b}\``;
  }
  const firstRemovedEdge = removedEdges[0];
  if (firstRemovedEdge) {
    const a = byId.get(firstRemovedEdge.from)?.label ?? firstRemovedEdge.from;
    const b = byId.get(firstRemovedEdge.to)?.label ?? firstRemovedEdge.to;
    return `Removed dependency \`${a}\` → \`${b}\``;
  }
  return `Updated ${diagram.bundle.label}`;
}

function commonDirectory(paths: string[]): string {
  if (paths.length === 0) return "repo";
  const partsList = paths.map((p) => path.dirname(p).split("/").filter((seg) => seg && seg !== "."));
  const first = partsList[0] ?? [];
  const common: string[] = [];
  for (let i = 0; i < first.length; i += 1) {
    const seg = first[i];
    if (seg && partsList.every((parts) => parts[i] === seg)) common.push(seg);
    else break;
  }
  return common.length > 0 ? `${common.join("/")}/` : "repo root";
}

function buildIacCountsClause(iac: IacBlockDelta): string {
  const parts: string[] = [];
  parts.push(`+${iac.resourcesAdded} resource${iac.resourcesAdded === 1 ? "" : "s"}`);
  if (iac.dataAdded > 0) parts.push(`+${iac.dataAdded} data`);
  if (iac.checksAdded > 0) parts.push(`+${iac.checksAdded} check${iac.checksAdded === 1 ? "" : "s"}`);
  if (iac.localsAdded > 0) parts.push(`+${iac.localsAdded} local${iac.localsAdded === 1 ? "" : "s"}`);
  if (iac.modulesAdded > 0) parts.push(`+${iac.modulesAdded} module${iac.modulesAdded === 1 ? "" : "s"}`);
  return `IaC: ${parts.join(" · ")}`;
}

export function triageCommitDiff(params: {
  commitDiff: CommitArchDiff;
  rankedDiagrams: RankedDiagram[];
  rankedFiles: RankedChangedFile[];
}): TriageResult {
  const { commitDiff, rankedDiagrams, rankedFiles } = params;
  const iacDelta = parseIacDiff(commitDiff.changedFiles);
  const testFiles = rankedFiles.filter((f) => f.fileClass === "test");
  const testsAddedLoc = testFiles.reduce((sum, f) => sum + f.file.insertions, 0);
  const testedInPrCount = rankedFiles.filter((f) => f.testedInPr).length;

  const contractFiles = rankedFiles.filter((f) => f.fileClass === "contract" || f.fileClass === "fixture");
  const sourceFiles = rankedFiles.filter((f) => f.fileClass === "source");
  const errorFindings = commitDiff.findings.introduced.filter((f) => f.severity === "error");
  const warnFindings = commitDiff.findings.introduced.filter((f) => f.severity === "warn");

  const surfaceRemovals =
    commitDiff.surfaces.endpointsRemoved.length + commitDiff.surfaces.entitiesRemoved.length;
  const surfaceAdditions =
    commitDiff.surfaces.endpointsAdded.length +
    commitDiff.surfaces.entitiesAdded.length +
    commitDiff.surfaces.envAdded.length +
    commitDiff.surfaces.externalAdded.length;

  const touchedTangles = rankedDiagrams.some((d) => d.breakdown.tangleCount > 0 && d.bundle.changedCount > 0);
  const attentionItems: AttentionItem[] = [];

  if (errorFindings.length > 0) {
    const first = errorFindings[0];
    attentionItems.push({
      kind: "violation",
      title: "New architectural violation",
      detail: `${errorFindings.length} failing check(s), starting with ${first?.invariantName ?? "rule"} in \`${first?.file ?? ""}\`.`,
    });
  }
  if (surfaceRemovals > 0) {
    const removed = [...commitDiff.surfaces.endpointsRemoved, ...commitDiff.surfaces.entitiesRemoved].slice(0, 2);
    attentionItems.push({
      kind: "contract",
      title: "Breaking surface removal",
      detail: `Removes ${removed.map((r) => `\`${r}\``).join(", ")}. Confirm callers migrated.`,
    });
  }
  if (iacDelta.mutatingSensitiveBlocks.length > 0) {
    attentionItems.push({
      kind: "sensitive",
      title: "Mutating sensitive IaC",
      detail: `Adds ${iacDelta.mutatingSensitiveBlocks.slice(0, 2).map((b) => `\`${b}\``).join(", ")}. Verify least-privilege blast radius.`,
    });
  } else if (iacDelta.sensitiveBlocks.length > 0) {
    attentionItems.push({
      kind: "sensitive",
      title: "Sensitive area (production IAM / policy)",
      detail: `Adds read-only ${iacDelta.sensitiveBlocks.slice(0, 2).map((b) => `\`${b}\``).join(", ")} — confirm plan identity permissions and check enforcement mode.`,
    });
  }
  if (contractFiles.length > 0 || surfaceAdditions > 0) {
    const items = [
      ...contractFiles.slice(0, 2).map((f) => `\`${f.file.path}\` (+${f.file.insertions})`),
      ...commitDiff.surfaces.endpointsAdded.slice(0, 2).map((e) => `\`${e}\``),
      ...commitDiff.surfaces.externalAdded.slice(0, 2).map((e) => `external \`${e}\``),
    ].slice(0, 3);
    attentionItems.push({
      kind: "contract",
      title: "Contract / external surface changed",
      detail: `${items.join(" and ")} updated — verify compatibility with downstream consumers.`,
    });
  }
  const riskyUntested = sourceFiles.find(
    (f) => f.preexistingDependents >= 3 && !f.testedInPr && (f.noDirectTest || (f.coverageKnown && (f.coveragePct ?? 100) < 50)),
  );
  if (riskyUntested && attentionItems.length < 3) {
    attentionItems.push({
      kind: "untested",
      title: "High-dependent edit without PR tests",
      detail: `\`${riskyUntested.file.path}\` has **${riskyUntested.preexistingDependents} existing dependents** and no test change in this PR.`,
    });
  }
  if (warnFindings.length > 0 && attentionItems.length < 3) {
    const first = warnFindings[0];
    attentionItems.push({
      kind: "violation",
      title: "New architectural warning",
      detail: `${warnFindings.length} warning(s), starting with ${first?.invariantName ?? "rule"} in \`${first?.file ?? ""}\`.`,
    });
  }

  let level: ReviewLevel = "skim";
  if (errorFindings.length > 0 || surfaceRemovals > 0 || touchedTangles || iacDelta.mutatingSensitiveBlocks.length > 0) {
    level = "scrutinize";
  } else if (attentionItems.length > 0) {
    level = "look";
  }

  const unitDiagramsChanged = rankedDiagrams.filter(
    (d) => d.bundle.id.startsWith("diff:modules:") && d.bundle.changedCount > 0,
  );
  const wiringDiagram = unitDiagramsChanged.find(
    (d) =>
      d.breakdown.changedEdges > 0 ||
      d.overlay.nodes.some((n) => n.diffStatus === "added" || n.diffStatus === "removed"),
  );
  const topSource = sourceFiles[0];

  let archetype: PrArchetype = "no_structure";
  if (errorFindings.length > 0) archetype = "violation";
  else if (unitDiagramsChanged.length >= 2 && wiringDiagram) archetype = "multi_unit";
  else if (wiringDiagram) archetype = "wiring";
  else if (iacDelta.sensitiveBlocks.length > 0) archetype = "iac_sensitive";
  else if (surfaceAdditions > 0 || surfaceRemovals > 0) archetype = "surface";
  else if (topSource && topSource.preexistingDependents >= 3) archetype = "symbol";

  let headline = "No architectural change";
  if (archetype === "violation") {
    const first = errorFindings[0];
    headline = `${errorFindings.length} new violation${errorFindings.length === 1 ? "" : "s"}: ${first?.invariantName ?? "rule check"}`;
  } else if (archetype === "wiring" && wiringDiagram) {
    headline = summarizeWiringHeadline(wiringDiagram);
  } else if (archetype === "multi_unit") {
    const slugs = unitDiagramsChanged
      .slice(0, 3)
      .map((d) => d.bundle.id.replace(/^diff:modules:/, ""))
      .join(", ");
    headline = `Touches ${unitDiagramsChanged.length} modules: ${slugs}`;
  } else if (archetype === "iac_sensitive") {
    const mode = iacDelta.mutatingSensitiveBlocks.length > 0 ? "mutating change" : "read-only check";
    headline = `Sensitive IaC update (${mode}) in \`${commonDirectory(iacDelta.iacFiles)}\``;
  } else if (archetype === "surface") {
    const ep = commitDiff.surfaces.endpointsAdded[0] ?? commitDiff.surfaces.endpointsRemoved[0];
    headline = ep ? `Surface change: \`${ep}\`` : "Runtime contract surface changed";
  } else if (archetype === "symbol" && topSource) {
    headline = `Changes \`${path.basename(topSource.file.path)}\`, used by ${topSource.preexistingDependents} modules`;
  } else {
    const classes = Array.from(new Set(rankedFiles.map((f) => f.fileClass)));
    const label = classes.includes("iac")
      ? "infra only"
      : classes.every((c) => c === "doc")
        ? "docs only"
        : classes.every((c) => c === "test")
          ? "tests only"
          : "no dependency changes";
    headline = `No architectural change — ${label}`;
  }

  const shapeParts: string[] = [];
  if (wiringDiagram) {
    const addedN = wiringDiagram.overlay.nodes.filter((n) => n.diffStatus === "added").length;
    const modN = wiringDiagram.overlay.nodes.filter((n) => n.diffStatus === "modified").length;
    const remN = wiringDiagram.overlay.nodes.filter((n) => n.diffStatus === "removed").length;
    if (addedN > 0) shapeParts.push(`${addedN} module${addedN === 1 ? "" : "s"} added`);
    if (modN > 0) shapeParts.push(`${modN} modified`);
    if (remN > 0) shapeParts.push(`${remN} removed`);
    if (wiringDiagram.breakdown.addedEdges > 0) {
      shapeParts.push(`${wiringDiagram.breakdown.addedEdges} new dep${wiringDiagram.breakdown.addedEdges === 1 ? "" : "s"}`);
    }
    if (wiringDiagram.breakdown.removedEdges > 0) {
      shapeParts.push(`${wiringDiagram.breakdown.removedEdges} removed dep${wiringDiagram.breakdown.removedEdges === 1 ? "" : "s"}`);
    }
  } else if (iacDelta.iacFiles.length > 0) {
    shapeParts.push(`no dependency changes`);
    shapeParts.push(`confined to \`${commonDirectory(iacDelta.iacFiles)}\``);
    shapeParts.push(buildIacCountsClause(iacDelta));
  } else {
    shapeParts.push(`${commitDiff.changedFiles.length} file${commitDiff.changedFiles.length === 1 ? "" : "s"} (+${commitDiff.kpis.files.insertions} −${commitDiff.kpis.files.deletions})`);
    shapeParts.push("no module or dependency changes");
  }

  shapeParts.push(errorFindings.length === 0 ? "no violations" : `${errorFindings.length} violation${errorFindings.length === 1 ? "" : "s"}`);
  if (testFiles.length > 0) shapeParts.push("tested in PR ✓");

  return {
    level,
    archetype,
    headline,
    shapeLine: shapeParts.join(" · "),
    attentionItems: attentionItems.slice(0, 3),
    iacDelta,
    testedInPrCount,
    testsAddedLoc,
  };
}
