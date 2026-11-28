import fs from "node:fs";
import path from "node:path";
import type { ExtractorPlugin, GraphFragment, RepoContext, Rung, SpecEdge, SpecNode, SpecRule, UnitDescriptor } from "@repospec/plugin";
import { extractQualityGatesAndRungs, type RungPathOverride } from "./gateManifests.ts";

interface TurboBoundariesJson {
  boundaries?: {
    tags?: Record<
      string,
      {
        dependencies?: { allow?: string[]; deny?: string[] };
        dependents?: { allow?: string[]; deny?: string[] };
      }
    >;
  };
}

function readTextSafe(absPath: string): string | null {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

function classifyTestRung(
  relPath: string,
  text?: string,
  rungOverrides: RungPathOverride[] = [],
): { tier: string; rung: Rung } {
  for (const ov of rungOverrides) {
    if (
      relPath === ov.pattern ||
      relPath.startsWith(`${ov.pattern}/`) ||
      relPath.toLowerCase().includes(`/${ov.pattern.toLowerCase()}/`) ||
      relPath.toLowerCase().endsWith(`/${ov.pattern.toLowerCase()}`)
    ) {
      return { tier: ov.tier, rung: ov.rung };
    }
  }
  const lower = relPath.toLowerCase();
  if (
    lower.endsWith(".dfy") ||
    lower.endsWith(".qnt") ||
    lower.endsWith(".tla") ||
    lower.includes("formalproof") ||
    lower.includes("modelcheck")
  ) {
    return { tier: "formal_proof", rung: "R8" };
  }
  if (lower.includes("e2e") || lower.includes("playwright") || lower.includes("/cypress/")) {
    return { tier: "e2e", rung: "R7" };
  }
  if (lower.includes("/load/") || lower.includes("benchmark") || lower.includes(".bench.") || lower.includes("k6")) {
    return { tier: "load_perf", rung: "R6" };
  }
  if (lower.startsWith("fuzz/") || lower.includes("stryker") || lower.includes("mutation") || lower.includes("fuzz_targets")) {
    return { tier: "mutation_fuzz", rung: "R5" };
  }
  if (
    lower.includes("cloud-integration") ||
    lower.includes("integration") ||
    lower.includes("emulator") ||
    lower.includes("migration") ||
    /^crates\/[^/]+\/tests\/.+\.rs$/.test(relPath)
  ) {
    return { tier: "integration", rung: "R4" };
  }
  if (
    lower.includes("contract") ||
    lower.includes("dashboard-ui") ||
    lower.includes("dashboard-edge") ||
    lower.includes(".component.") ||
    lower.endsWith(".test.tsx") ||
    lower.endsWith(".spec.tsx") ||
    lower.includes("mbt") ||
    (text && /Machine<|ModelState/.test(text))
  ) {
    return { tier: "component_contract", rung: "R3" };
  }
  if (text && /proptest!|\[Property\b/.test(text)) {
    return { tier: "property_pbt", rung: "R2" };
  }
  return { tier: "unit_pure", rung: "R2" };
}

function workspacePrefixOf(relFile: string, units: UnitDescriptor[]): string {
  let bestUnitDir = "";
  for (const u of units) {
    if (!u.dir || u.dir === ".") continue;
    if (relFile === u.dir || relFile.startsWith(`${u.dir}/`)) {
      if (u.dir.length > bestUnitDir.length) bestUnitDir = u.dir;
    }
  }
  if (bestUnitDir) return bestUnitDir;
  const parts = relFile.split("/");
  if (parts.length >= 2 && ["apps", "packages", "tests", "crates"].includes(parts[0] ?? "")) {
    return `${parts[0]}/${parts[1]}`;
  }
  if (parts.length >= 2 && (parts[0] ?? "").endsWith(".Tests")) {
    return parts[0] ?? "root";
  }
  if (parts[0] === "fuzz") return "fuzz";
  return "root";
}

export const testingAndRulesExtractor: ExtractorPlugin = {
  id: "test-rules.verification.v3",
  domain: "test",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const nodes: SpecNode[] = [];
    const edges: SpecEdge[] = [];
    const rules: SpecRule[] = [];
    const gateManifest = extractQualityGatesAndRungs(ctx);
    nodes.push(...gateManifest.nodes);
    rules.push(...gateManifest.rules);

    const suiteBuckets = new Map<
      string,
      { workspaceDir: string; tier: string; rung: Rung; files: string[] }
    >();

    const addTestFile = (rel: string, text?: string): void => {
      const workspaceDir = workspacePrefixOf(rel, ctx.units);
      const { tier, rung } = classifyTestRung(rel, text, gateManifest.rungOverrides);
      const key = `${workspaceDir}::${tier}`;
      const existing = suiteBuckets.get(key);
      if (existing) existing.files.push(rel);
      else suiteBuckets.set(key, { workspaceDir, tier, rung, files: [rel] });
    };

    for (const rel of ctx.allFiles) {
      if (
        /(?:^|\/)(?:__tests__\/|.*\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs))$/.test(rel) ||
        /^tests\/[^/]+\/.*\.(?:ts|tsx|js|jsx|mjs)$/.test(rel)
      ) {
        addTestFile(rel);
        continue;
      }

      if (rel.endsWith(".rs")) {
        if (/^crates\/[^/]+\/tests\/.+\.rs$/.test(rel) || /^fuzz\/fuzz_targets\/.+\.rs$/.test(rel) || rel.endsWith("_tests.rs")) {
          const txt = readTextSafe(path.join(ctx.rootDir, rel)) ?? "";
          addTestFile(rel, txt);
        } else {
          const txt = readTextSafe(path.join(ctx.rootDir, rel));
          if (txt && (/#\[cfg\(test\)\]/.test(txt) || /proptest!\s*\{/.test(txt))) {
            addTestFile(rel, txt);
          }
        }
        continue;
      }

      if (rel.endsWith(".dfy") || rel.endsWith(".qnt") || rel.endsWith(".tla")) {
        addTestFile(rel);
        continue;
      }

      if (rel.endsWith(".cs")) {
        const txt = readTextSafe(path.join(ctx.rootDir, rel));
        if (
          /Tests?\.cs$/i.test(rel) ||
          (txt && /\[(Fact|Theory|Property|Test|TestMethod)\b/.test(txt))
        ) {
          addTestFile(rel, txt ?? undefined);
        }
      }
    }

    for (const [, bucket] of Array.from(suiteBuckets.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const sortedFiles = [...bucket.files].sort();
      const suiteId = `test:suite:${bucket.workspaceDir}:${bucket.tier}`;
      nodes.push({
        id: suiteId,
        domain: "test",
        kind: "test_suite",
        label: `${bucket.workspaceDir} (${bucket.tier})`,
        group: bucket.rung,
        provenance: { file: sortedFiles[0] ?? bucket.workspaceDir },
        tags: [bucket.rung, bucket.tier],
        meta: {
          workspaceDir: bucket.workspaceDir,
          tier: bucket.tier,
          rung: bucket.rung,
          fileCount: sortedFiles.length,
          sampleFiles: sortedFiles.slice(0, 5),
        },
      });
    }

    const turboPath = path.join(ctx.rootDir, "turbo.json");
    const turboText = readTextSafe(turboPath);
    if (turboText) {
      try {
        const parsed = JSON.parse(turboText) as TurboBoundariesJson;
        const tagRules = parsed.boundaries?.tags ?? {};
        for (const tag of Object.keys(tagRules).sort()) {
          const def = tagRules[tag];
          if (!def) continue;
          const denyDeps = def.dependencies?.deny ?? [];
          const denyDependents = def.dependents?.deny ?? [];
          const parts: string[] = [];
          if (denyDeps.length > 0) parts.push(`cannot depend on [${denyDeps.join(", ")}]`);
          if (denyDependents.length > 0) parts.push(`cannot be depended on by [${denyDependents.join(", ")}]`);
          const statement = `Tag "${tag}" ${parts.join("; ") || "has boundary rules"}`;

          const nodeId = `rule:boundary:${tag}`;
          nodes.push({
            id: nodeId,
            domain: "rules",
            kind: "boundary_policy",
            label: `Boundary: ${tag}`,
            group: "boundary",
            provenance: { file: "turbo.json" },
            tags: ["R1", "boundary", tag],
            meta: {
              tag,
              denyDependencies: denyDeps,
              denyDependents,
            },
          });

          rules.push({
            id: nodeId,
            name: `turbo-boundary:${tag}`,
            category: "boundary",
            enforcement: "static",
            rung: "R1",
            statement,
            targets: [tag],
            provenance: { file: "turbo.json" },
          });
        }
      } catch {
        rules.push({
          id: "rule:boundary:parse-error",
          name: "turbo-boundary-parse-error",
          category: "boundary",
          enforcement: "static",
          rung: "R1",
          statement: "turbo.json could not be parsed as strict JSON",
          targets: ["turbo.json"],
          provenance: { file: "turbo.json" },
        });
      }
    }

    const codeownersPath = path.join(ctx.rootDir, ".github/CODEOWNERS");
    const codeownersText = readTextSafe(codeownersPath);
    if (codeownersText) {
      const lines = codeownersText.split("\n");
      let ruleIdx = 0;
      for (let i = 0; i < lines.length; i += 1) {
        const trimmed = (lines[i] ?? "").trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const parts = trimmed.split(/\s+/);
        const pattern = parts[0];
        const owners = parts.slice(1);
        if (!pattern || owners.length === 0) continue;
        ruleIdx += 1;
        const id = `rule:codeowners:${String(ruleIdx).padStart(2, "0")}`;
        rules.push({
          id,
          name: `codeowners:${pattern}`,
          category: "ownership",
          enforcement: "ownership",
          rung: "R0",
          statement: `Path "${pattern}" owned by ${owners.join(", ")}`,
          targets: [pattern],
          provenance: { file: ".github/CODEOWNERS", line: i + 1 },
        });
      }
      if (ruleIdx > 0) {
        nodes.push({
          id: "rule:config:codeowners",
          domain: "rules",
          kind: "ownership_rule",
          label: `CODEOWNERS (${ruleIdx} rules)`,
          group: "ownership",
          provenance: { file: ".github/CODEOWNERS", line: 1 },
          tags: ["R0", "ownership"],
          meta: { ruleCount: ruleIdx },
        });
      }
    }

    const staticConfigs: Array<{ filePattern: RegExp; id: string; label: string; rung: Rung; statement: string }> = [
      {
        filePattern: /^\.oxlintrc\.jsonc?$/,
        id: "rule:config:oxlint",
        label: "Oxlint Policy",
        rung: "R0",
        statement: "Oxlint static lint rules configured at repository root",
      },
      {
        filePattern: /^knip\.jsonc?$/,
        id: "rule:config:knip",
        label: "Knip Dead-Code Policy",
        rung: "R1",
        statement: "Knip unused export/file/dependency gate configured",
      },
      {
        filePattern: /^\.jscpd\.json$/,
        id: "rule:config:jscpd",
        label: "JSCPD Duplication Ratchet",
        rung: "R1",
        statement: "JSCPD clone/duplication detection and baseline configured",
      },
      {
        filePattern: /^lefthook\.ya?ml$/,
        id: "rule:config:lefthook",
        label: "Lefthook Pre-Commit Hooks",
        rung: "R0",
        statement: "Local git hook enforcement via lefthook",
      },
      {
        filePattern: /^\.github\/actionlint\.ya?ml$/,
        id: "rule:config:actionlint",
        label: "Actionlint CI Policy",
        rung: "R0",
        statement: "GitHub Actions YAML static analysis configured via actionlint",
      },
    ];

    const matchedByConfigId = new Map<string, string>();
    for (const rel of ctx.allFiles) {
      for (const cfg of staticConfigs) {
        if (!matchedByConfigId.has(cfg.id) && cfg.filePattern.test(rel)) {
          matchedByConfigId.set(cfg.id, rel);
        }
      }
      if (matchedByConfigId.size === staticConfigs.length) break;
    }

    for (const cfg of staticConfigs) {
      const matched = matchedByConfigId.get(cfg.id);
      if (!matched) continue;
      nodes.push({
        id: cfg.id,
        domain: "rules",
        kind: "linter_config",
        label: cfg.label,
        group: "static_config",
        provenance: { file: matched, line: 1 },
        tags: [cfg.rung, "static"],
        meta: { configFile: matched },
      });
      rules.push({
        id: cfg.id,
        name: cfg.label,
        category: "lint_ratchet",
        enforcement: "static",
        rung: cfg.rung,
        statement: cfg.statement,
        targets: ["repo"],
        provenance: { file: matched, line: 1 },
      });
    }

    return { nodes, edges, rules };
  },
};
