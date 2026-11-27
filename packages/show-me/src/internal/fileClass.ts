import path from "node:path";
import type { ChangedFileEntry } from "@repospec/plugin-studio";
import type { DrilldownIndex } from "@repospec/plugin-studio";

export type FileClass = "source" | "test" | "fixture" | "contract" | "iac" | "script" | "doc" | "config";

export interface IacBlockDelta {
  iacFiles: string[];
  resourcesAdded: number;
  dataAdded: number;
  checksAdded: number;
  localsAdded: number;
  modulesAdded: number;
  sensitiveBlocks: string[];
  mutatingSensitiveBlocks: string[];
  topHunkLines: string[];
}

const SENSITIVE_IAC_RE = /(?:iam|policy|role|permission|firewall|security_group|kms|secret|auth|acl)/i;

export function classifyFile(filePath: string): FileClass {
  const norm = filePath.replaceAll("\\", "/").toLowerCase();
  const base = path.basename(norm);

  if (
    norm.endsWith(".tftest.hcl") ||
    /(?:^|\/)(?:__tests__|tests?)\//.test(norm) && !norm.includes("/fixtures/") ||
    /\.(?:test|spec)\.[a-z0-9]+$/.test(base)
  ) {
    return "test";
  }
  if (
    norm.includes("/fixtures/") ||
    norm.includes("/__fixtures__/") ||
    norm.includes("wire.json") ||
    norm.endsWith(".snap")
  ) {
    return "fixture";
  }
  if (
    norm.startsWith("docs/contracts/") ||
    norm.includes("/contracts/") ||
    base === "openapi.json" ||
    base === "openapi.yaml" ||
    base === "openapi.yml" ||
    norm.endsWith(".proto") ||
    norm.endsWith(".graphql") ||
    norm.endsWith(".gql")
  ) {
    return "contract";
  }
  if (
    norm.endsWith(".tf") ||
    norm.endsWith(".tfvars") ||
    norm.endsWith(".hcl") ||
    norm.includes("/infra/") ||
    norm.startsWith("infra/") ||
    norm.includes("/terraform/") ||
    norm.startsWith("terraform/")
  ) {
    if (norm.endsWith(".md") || norm.endsWith(".txt")) return "doc";
    if (norm.endsWith(".sh") || norm.endsWith(".mjs") || norm.endsWith(".bash")) return "script";
    return "iac";
  }
  if (
    norm.endsWith(".md") ||
    norm.endsWith(".mdx") ||
    norm.endsWith(".txt") ||
    norm.startsWith("docs/")
  ) {
    return "doc";
  }
  if (
    norm.endsWith(".sh") ||
    norm.endsWith(".bash") ||
    norm.endsWith(".zsh") ||
    norm.startsWith("scripts/") ||
    norm.startsWith("tools/") ||
    norm.startsWith(".github/")
  ) {
    return "script";
  }
  if (
    base === "package.json" ||
    base === "bun.lock" ||
    base === "pnpm-lock.yaml" ||
    base === "package-lock.json" ||
    base === "yarn.lock" ||
    base === "tsconfig.json" ||
    base.endsWith(".config.ts") ||
    base.endsWith(".config.js") ||
    base.endsWith(".config.mjs") ||
    norm.endsWith(".json") ||
    norm.endsWith(".yaml") ||
    norm.endsWith(".yml") ||
    norm.endsWith(".toml")
  ) {
    return "config";
  }
  return "source";
}

function normalizeStem(filePath: string): string {
  return path
    .basename(filePath)
    .toLowerCase()
    .replace(/\.(?:test|spec|unit\.test|integration\.test|tftest)\.[a-z0-9]+$/, "")
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function detectTestedInPr(
  changedFiles: ChangedFileEntry[],
  drilldown?: DrilldownIndex,
): Set<string> {
  const tested = new Set<string>();
  const testEntries = changedFiles.filter((f) => classifyFile(f.path) === "test");
  if (testEntries.length === 0) return tested;

  const testPaths = new Set(testEntries.map((t) => t.path));
  const testStems = testEntries.map((t) => normalizeStem(t.path)).filter((s) => s.length >= 4);
  const testHunksCombined = testEntries
    .map((t) => t.hunk ?? "")
    .join("\n")
    .toLowerCase();

  if (drilldown) {
    const pathByIdx = drilldown.files.map((f) => f.p);
    for (const [fromIdx, toIdx] of drilldown.edges) {
      const fromPath = pathByIdx[fromIdx];
      const toPath = pathByIdx[toIdx];
      if (fromPath && toPath && testPaths.has(fromPath)) tested.add(toPath);
    }
  }

  const drillByPath = new Map((drilldown?.files ?? []).map((f) => [f.p, f]));
  for (const cf of changedFiles) {
    const cls = classifyFile(cf.path);
    if (cls !== "source" && cls !== "iac") continue;
    const stem = normalizeStem(cf.path);
    if (stem.length >= 4 && testStems.some((ts) => ts === stem || ts.includes(stem) || stem.includes(ts))) {
      tested.add(cf.path);
      continue;
    }
    const df = drillByPath.get(cf.path);
    if (df && testHunksCombined.length > 0) {
      const symHit = df.s.some(([name]) => name.length >= 5 && testHunksCombined.includes(name.toLowerCase()));
      if (symHit) tested.add(cf.path);
    }
  }
  return tested;
}

function isBoilerplateDiffLine(line: string): boolean {
  const body = line.slice(1).trim();
  if (body.length === 0) return true;
  if (/^[}\]),;]+$/.test(body)) return true;
  return false;
}

export function parseIacDiff(changedFiles: ChangedFileEntry[]): IacBlockDelta {
  const iacEntries = changedFiles.filter((f) => classifyFile(f.path) === "iac");
  let resourcesAdded = 0;
  let dataAdded = 0;
  let checksAdded = 0;
  let localsAdded = 0;
  let modulesAdded = 0;
  const sensitiveBlocks: string[] = [];
  const mutatingSensitiveBlocks: string[] = [];
  const blockHeaders: string[] = [];
  const otherLines: string[] = [];
  let primaryIac: ChangedFileEntry | undefined;

  for (const f of iacEntries) {
    if (!primaryIac && (f.path.endsWith(".tf") || f.path.endsWith(".hcl"))) {
      primaryIac = f;
    }
    const lines = (f.hunk ?? "").split("\n");
    for (const ln of lines) {
      if (!ln.startsWith("+") || ln.startsWith("+++")) continue;
      const body = ln.slice(1).trim();

      const resMatch = body.match(/^resource\s+"([^"]+)"\s+"([^"]+)"/);
      if (resMatch) {
        resourcesAdded += 1;
        const desc = `resource "${resMatch[1]}" "${resMatch[2]}"`;
        blockHeaders.push(ln);
        if (SENSITIVE_IAC_RE.test(desc)) {
          sensitiveBlocks.push(desc);
          mutatingSensitiveBlocks.push(desc);
        }
        continue;
      }
      const dataMatch = body.match(/^data\s+"([^"]+)"\s+"([^"]+)"/);
      if (dataMatch) {
        dataAdded += 1;
        const desc = `data "${dataMatch[1]}" "${dataMatch[2]}"`;
        blockHeaders.push(ln);
        if (SENSITIVE_IAC_RE.test(desc)) sensitiveBlocks.push(desc);
        continue;
      }
      const checkMatch = body.match(/^check\s+"([^"]+)"/);
      if (checkMatch) {
        checksAdded += 1;
        const desc = `check "${checkMatch[1]}"`;
        blockHeaders.push(ln);
        if (SENSITIVE_IAC_RE.test(desc)) sensitiveBlocks.push(desc);
        continue;
      }
      if (/^locals\s*\{/.test(body)) {
        localsAdded += 1;
        blockHeaders.push(ln);
        continue;
      }
      const modMatch = body.match(/^module\s+"([^"]+)"/);
      if (modMatch) {
        modulesAdded += 1;
        blockHeaders.push(ln);
        continue;
      }
      if (!isBoilerplateDiffLine(ln) && otherLines.length < 24) {
        otherLines.push(ln);
      }
    }
  }

  const orderedLines: string[] = [];
  const chosenIac = primaryIac ?? iacEntries[0];
  if (chosenIac?.hunk) {
    for (const ln of chosenIac.hunk.split("\n")) {
      if (!ln.startsWith("+") && !ln.startsWith("-")) continue;
      if (ln.startsWith("+++") || ln.startsWith("---")) continue;
      if (isBoilerplateDiffLine(ln)) continue;
      orderedLines.push(ln);
      if (orderedLines.length >= 10) break;
    }
  }

  return {
    iacFiles: iacEntries.map((f) => f.path),
    resourcesAdded,
    dataAdded,
    checksAdded,
    localsAdded,
    modulesAdded,
    sensitiveBlocks: Array.from(new Set(sensitiveBlocks)),
    mutatingSensitiveBlocks: Array.from(new Set(mutatingSensitiveBlocks)),
    topHunkLines: orderedLines.length > 0 ? orderedLines : [...blockHeaders, ...otherLines].slice(0, 10),
  };
}
