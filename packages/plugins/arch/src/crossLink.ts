import path from "node:path";
import type { GraphFragment, RepoContext, SpecEdge, SpecNode } from "@repospec/plugin";
import { CROSS_LINK_GATES } from "./crossLinkGates.ts";
import { isDeployableComputeResource } from "@repospec/plugin-iac";

const {
  normalizeToken,
  hasWholeToken,
  readTextSafe,
  collectAllPackageScripts,
  buildPrChecksExpansionMap,
  resolveInvokedGatesInWorkflow,
} = CROSS_LINK_GATES;

export function buildCrossDomainLinks(
  ctx: RepoContext,
  fragments: GraphFragment[],
): GraphFragment {
  const allNodes: SpecNode[] = [];
  const allEdges: SpecEdge[] = [];
  for (const f of fragments) {
    allNodes.push(...f.nodes);
    allEdges.push(...f.edges);
  }

  const edges: SpecEdge[] = [];

  const archUnits = allNodes.filter(
    (n) =>
      n.kind === "app" ||
      n.kind === "package" ||
      n.kind === "test_package" ||
      n.kind === "native_app" ||
      n.kind === "analyzer",
  );
  const wfNodes = allNodes.filter((n) => n.kind === "workflow");
  const testNodes = allNodes.filter((n) => n.kind === "test_suite");
  const iacNodes = allNodes.filter((n) => n.domain === "iac");
  const ruleNodes = allNodes.filter((n) => n.domain === "rules");

  const unitByDir = new Map<string, SpecNode>();
  const unitBySlug = new Map<string, SpecNode>();
  const unitById = new Map<string, SpecNode>();
  for (const node of archUnits) {
    const dir = typeof node.meta.dir === "string" ? node.meta.dir : null;
    const slug = typeof node.meta.slug === "string" ? node.meta.slug : normalizeToken(node.label);
    if (dir) unitByDir.set(dir, node);
    unitBySlug.set(normalizeToken(slug), node);
    unitById.set(node.id, node);
  }

  const testPkgToTargets = new Map<string, SpecNode[]>();
  for (const e of allEdges) {
    if (e.kind !== "depends_on") continue;
    const fromU = unitById.get(e.from);
    const toU = unitById.get(e.to);
    if (fromU?.kind === "test_package" && toU && (toU.kind === "app" || toU.kind === "package" || toU.kind === "analyzer")) {
      const list = testPkgToTargets.get(fromU.id) ?? [];
      list.push(toU);
      testPkgToTargets.set(fromU.id, list);
    }
  }

  const openApiProducers = archUnits.filter((n) => n.meta.hasOpenApi === true);
  const openApiConsumers = archUnits.filter((n) => n.meta.hasGeneratedClient === true);
  for (const consumer of openApiConsumers) {
    for (const producer of openApiProducers) {
      if (consumer.id !== producer.id) {
        edges.push({
          from: consumer.id,
          to: producer.id,
          kind: "routes_to",
          label: "OpenAPI SDK",
          confidence: "inferred",
          provenance: consumer.provenance,
          evidence: [{ file: consumer.provenance.file, detail: `Generated client targeting ${producer.label}` }],
        });
      }
    }
  }

  const allGateNodes = ruleNodes.filter((n) => n.kind === "quality_gate");
  const gateNodeByName = new Map<string, SpecNode>();
  const allGateInfos = allGateNodes.map((n) => {
    const name = typeof n.meta.gateName === "string" ? n.meta.gateName : n.label;
    gateNodeByName.set(name, n);
    return {
      name,
      scriptPath: typeof n.meta.scriptPath === "string" ? n.meta.scriptPath : null,
      commandHint: typeof n.meta.commandHint === "string" ? n.meta.commandHint : "",
      rung: typeof n.meta.rung === "string" ? n.meta.rung : undefined,
    };
  });

  const allScripts = collectAllPackageScripts(ctx);
  const prCheckMap = buildPrChecksExpansionMap(ctx.rootDir, allGateInfos, allScripts);

  const compositeActionTexts = new Map<string, string>();
  for (const f of ctx.allFiles) {
    if (/^\.github\/actions\/[^/]+\/action\.ya?ml$/.test(f)) {
      const dir = path.posix.dirname(f);
      compositeActionTexts.set(`./${dir}`, readTextSafe(path.join(ctx.rootDir, f)));
    }
  }

  for (const suite of testNodes) {
    const wsDir = typeof suite.meta.workspaceDir === "string" ? suite.meta.workspaceDir : null;
    const rungLabel = typeof suite.meta.rung === "string" ? suite.meta.rung : "test";
    if (wsDir && unitByDir.has(wsDir)) {
      const target = unitByDir.get(wsDir);
      if (target) {
        const prodTargets = target.kind === "test_package" ? (testPkgToTargets.get(target.id) ?? []) : [];
        if (prodTargets.length > 0) {
          for (const prod of prodTargets) {
            edges.push({
              from: suite.id,
              to: prod.id,
              kind: "verifies",
              label: rungLabel,
              confidence: "observed",
              provenance: suite.provenance,
            });
          }
        } else {
          edges.push({
            from: suite.id,
            to: target.id,
            kind: "verifies",
            label: rungLabel,
            confidence: "observed",
            provenance: suite.provenance,
          });
        }
      }
    }

    if (wsDir && wsDir.startsWith("tests/")) {
      const slug = normalizeToken(wsDir.replace(/^tests\//, ""));
      if (slug.includes("dashboard")) {
        for (const unit of archUnits) {
          if (unit.kind === "app" && (unit.label.includes("dashboard") || unit.label.includes("portal"))) {
            edges.push({
              from: suite.id,
              to: unit.id,
              kind: "verifies",
              label: rungLabel,
              confidence: "inferred",
              provenance: suite.provenance,
            });
          }
        }
      } else {
        for (const unit of archUnits) {
          if (unit.kind !== "app") continue;
          const uSlug = normalizeToken(unit.label);
          if (uSlug.includes("api") && (slug.includes("integration") || slug.includes("load") || slug.includes("contract"))) {
            edges.push({
              from: suite.id,
              to: unit.id,
              kind: "verifies",
              label: rungLabel,
              confidence: "inferred",
              provenance: suite.provenance,
            });
          }
        }
      }
    }
  }

  for (const wf of wfNodes) {
    const wfFile = wf.provenance.file;
    const wfBase = typeof wf.meta.fileBase === "string" ? wf.meta.fileBase.toLowerCase() : "";
    const wfContent = readTextSafe(path.join(ctx.rootDir, wfFile));
    const isDeployWf =
      wf.group === "deploy_release" ||
      wf.group === "release" ||
      wfBase.includes("deploy") ||
      wfBase.includes("release") ||
      wfBase.includes("infra") ||
      wfBase.includes("env0") ||
      wf.tags.includes("env0") ||
      /\b(?:terraform|tofu)\s+(?:apply|plan)\b/i.test(wfContent);
    const wfIacDirs = Array.isArray(wf.meta.iacDirectories)
      ? wf.meta.iacDirectories.filter((d): d is string => typeof d === "string")
      : [];
    const runsCargoWorkspace = /\bcargo\s+(?:test|nextest|clippy|check|build)\b[\s\S]{0,120}--workspace/.test(wfContent);

    for (const unit of archUnits) {
      const dir = typeof unit.meta.dir === "string" ? unit.meta.dir : "";
      const slug = typeof unit.meta.slug === "string" ? normalizeToken(unit.meta.slug) : normalizeToken(unit.label);
      const bins = Array.isArray(unit.meta.bins) ? unit.meta.bins : [];
      const isRustUnit = unit.meta.ecosystem === "rust";

      const matchedByCargo =
        isRustUnit &&
        (wfContent.includes(`-p ${unit.label}`) ||
          wfContent.includes(`--package ${unit.label}`) ||
          bins.some((b) => typeof b === "string" && wfContent.includes(`--bin ${b}`)) ||
          (runsCargoWorkspace && (unit.kind === "app" || unit.kind === "package")));

      const matched =
        (slug.length >= 4 && hasWholeToken(wfBase, slug)) ||
        (dir.length > 1 && wfContent.includes(`${dir}/`)) ||
        (unit.label.startsWith("@") && wfContent.includes(unit.label)) ||
        matchedByCargo;

      if (matched) {
        edges.push({
          from: wf.id,
          to: unit.id,
          kind: isDeployWf ? "deploys" : "verifies",
          label: isDeployWf ? "deploys" : "ci",
          confidence: "observed",
          provenance: { file: wfFile },
        });
      }
    }

    for (const suite of testNodes) {
      const wsDir = typeof suite.meta.workspaceDir === "string" ? suite.meta.workspaceDir : "";
      const suiteSlug = normalizeToken(wsDir.replace(/^(?:tests|apps|packages|crates)\//, ""));
      const matched =
        (wsDir.length > 1 && wfContent.includes(`${wsDir}/`)) ||
        (suiteSlug.length >= 5 && hasWholeToken(wfBase, suiteSlug));
      if (matched) {
        edges.push({
          from: wf.id,
          to: suite.id,
          kind: "verifies",
          label: "runs",
          confidence: "observed",
          provenance: { file: wfFile },
        });
      }
    }

    const invokedGates = resolveInvokedGatesInWorkflow(
      ctx.rootDir,
      wfContent,
      allGateInfos,
      prCheckMap,
      allScripts,
      compositeActionTexts,
      wfFile,
    );
    for (const gateName of invokedGates) {
      const gateNode = gateNodeByName.get(gateName);
      if (gateNode) {
        edges.push({
          from: wf.id,
          to: gateNode.id,
          kind: "enforces_in_ci",
          label: "gate",
          confidence: "observed",
          provenance: { file: wfFile },
        });
      }
    }

    for (const iac of iacNodes) {
      if (iac.kind === "iac_container") {
        const dfFile = typeof iac.meta.file === "string" ? iac.meta.file : iac.provenance.file;
        if (wfContent.includes(dfFile)) {
          edges.push({
            from: wf.id,
            to: iac.id,
            kind: "builds_image",
            label: "docker",
            confidence: "observed",
            provenance: { file: wfFile },
          });
        }
      }
      if (iac.kind === "iac_resource") {
        const tfDir = path.posix.dirname(iac.provenance.file);
        const resName = typeof iac.meta.resourceName === "string" ? iac.meta.resourceName : "";
        const cloudName = typeof iac.meta.cloudName === "string" ? iac.meta.cloudName : "";
        const wfDirMatch =
          (tfDir !== "." && wfContent.includes(tfDir)) ||
          wfIacDirs.some((d) => d === "." || d === tfDir || tfDir.startsWith(`${d}/`) || d.startsWith(`${tfDir}/`));
        const wfAppliesIac =
          wf.tags.includes("env0") ||
          /\b(?:terraform|tofu)\s+(?:apply|plan|init)\b/i.test(wfContent) ||
          (resName.length >= 3 && wfContent.includes(resName)) ||
          (cloudName.length >= 3 && wfContent.includes(cloudName));
        if (isDeployWf && (wfDirMatch || (iac.meta.deployableCompute === true && wfAppliesIac))) {
          edges.push({
            from: wf.id,
            to: iac.id,
            kind: "deploys",
            label: wf.tags.includes("env0") ? "env0" : "terraform",
            confidence: wfDirMatch ? "observed" : "inferred",
            provenance: { file: wfFile },
          });
        }
      }
    }
  }

  const appUnitsWithNorm = archUnits
    .filter((u) => u.kind === "app")
    .map((u) => ({ unit: u, norm: normalizeToken(u.label) }));
  const firstApiApp = appUnitsWithNorm.find((entry) => entry.norm.includes("api"))?.unit ?? null;

  const matchCloudRunUnit = (resName: string, usesApiImage: boolean): SpecNode | null => {
    const normRes = normalizeToken(resName);
    for (const entry of appUnitsWithNorm) {
      if (entry.norm.includes(normRes)) return entry.unit;
    }
    if (resName === "api" || usesApiImage) return firstApiApp;
    return null;
  };

  for (const iac of iacNodes) {
    if (iac.kind === "iac_container") {
      const dfFile = typeof iac.meta.file === "string" ? iac.meta.file : iac.provenance.file;
      const dfDir = path.posix.dirname(dfFile);
      const targetUnit = unitByDir.get(dfDir);
      if (targetUnit) {
        edges.push({
          from: iac.id,
          to: targetUnit.id,
          kind: "builds_image",
          label: "image",
          confidence: "observed",
          provenance: iac.provenance,
        });
      }
    }

    if (iac.kind === "iac_resource") {
      const resType = typeof iac.meta.resourceType === "string" ? iac.meta.resourceType : "";
      const resName = typeof iac.meta.resourceName === "string" ? iac.meta.resourceName : "";
      const usesApiImage = iac.meta.usesApiImage === true;

      if (resType === "google_cloud_run_v2_service" || isDeployableComputeResource(resType)) {
        const matchUnit = matchCloudRunUnit(resName, usesApiImage);
        if (matchUnit) {
          edges.push({
            from: iac.id,
            to: matchUnit.id,
            kind: "deploys",
            label: resType.startsWith("google_cloud_run") ? "cloud-run" : "compute",
            confidence: "observed",
            provenance: iac.provenance,
          });
        }
      }
    }
  }

  for (const rule of ruleNodes) {
    if (rule.kind === "boundary_policy") {
      for (const unit of archUnits) {
        if (unit.kind === "app" || unit.kind === "package") {
          edges.push({
            from: rule.id,
            to: unit.id,
            kind: "governs",
            label: "boundary",
            confidence: "observed",
            provenance: rule.provenance,
          });
        }
      }
    }
  }

  return { nodes: [], edges, rules: [] };
}
