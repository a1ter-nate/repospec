import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { ExtractorPlugin, GraphFragment, RepoContext, SpecEdge, SpecNode } from "../schema.ts";
import {
  isAzurePipelineDoc,
  isAzurePipelineFile,
  isEnv0WorkflowFile,
  parseAzurePipelineWorkflow,
  parseEnv0Workflow,
} from "../internal/extractors/ciProviders.ts";

interface RawWorkflow {
  name?: string;
  on?: unknown;
  true?: unknown;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean } | string;
  jobs?: Record<
    string,
    {
      name?: string;
      needs?: string | string[];
      "runs-on"?: string | string[];
      uses?: string;
      strategy?: { matrix?: unknown };
      environment?: string | { name?: string };
      steps?: Array<{ name?: string; run?: string; uses?: string }>;
    }
  >;
}

function normalizeTriggers(rawOn: unknown): { triggers: string[]; workflowRuns: string[]; paths: string[] } {
  const triggers = new Set<string>();
  const workflowRuns = new Set<string>();
  const paths = new Set<string>();

  if (typeof rawOn === "string") {
    triggers.add(rawOn);
  } else if (Array.isArray(rawOn)) {
    for (const item of rawOn) {
      if (typeof item === "string") triggers.add(item);
    }
  } else if (rawOn && typeof rawOn === "object") {
    for (const [key, val] of Object.entries(rawOn as Record<string, unknown>)) {
      triggers.add(key);
      if (val && typeof val === "object") {
        const obj = val as Record<string, unknown>;
        if (key === "workflow_run" && Array.isArray(obj.workflows)) {
          for (const wf of obj.workflows) {
            if (typeof wf === "string") workflowRuns.add(wf);
          }
        }
        if (Array.isArray(obj.paths)) {
          for (const p of obj.paths) {
            if (typeof p === "string") paths.add(p);
          }
        }
      }
    }
  }

  return {
    triggers: Array.from(triggers).sort(),
    workflowRuns: Array.from(workflowRuns).sort(),
    paths: Array.from(paths).sort(),
  };
}

function classifyWorkflowCategory(fileBase: string, triggers: string[]): string {
  const lower = fileBase.toLowerCase();
  if (lower.includes("release") || lower.includes("deploy") || lower.includes("testflight") || lower.includes("apply")) {
    return "release";
  }
  if (lower.includes("canary") || lower.includes("canaries") || lower.includes("drift") || lower.includes("watchdog")) {
    return "production_ops";
  }
  if (lower.includes("mutation") || lower.includes("ratchet") || lower.includes("daily") || triggers.includes("schedule")) {
    return "scheduled_quality";
  }
  if (lower.includes("e2e") || lower.includes("integration") || lower.includes("contract")) {
    return "verification";
  }
  if (lower.includes("security") || lower.includes("secret") || lower.includes("audit") || lower.includes("review")) {
    return "security_review";
  }
  return "ci";
}

function normalizeRunner(runsOn: string | string[] | undefined): string {
  if (!runsOn) return "reusable";
  if (Array.isArray(runsOn)) return runsOn.join(",");
  return runsOn;
}

export const ciExtractor: ExtractorPlugin = {
  id: "ci.delivery-workflows.v2",
  domain: "ci",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const nodes: SpecNode[] = [];
    const edges: SpecEdge[] = [];

    const workflowFiles = ctx.allFiles
      .filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))
      .sort();

    const wfIdByName = new Map<string, string>();
    const pendingWorkflowRuns: Array<{ from: string; targetName: string; file: string }> = [];

    for (const relFile of workflowFiles) {
      const absFile = path.join(ctx.rootDir, relFile);
      let rawText: string;
      let parsed: RawWorkflow | null = null;
      try {
        rawText = fs.readFileSync(absFile, "utf8");
        parsed = yaml.load(rawText) as RawWorkflow | null;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;

      const fileBase = path.posix.basename(relFile).replace(/\.ya?ml$/, "");
      const wfId = `ci:wf:${fileBase}`;
      const wfName = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : fileBase;
      const { triggers, workflowRuns, paths } = normalizeTriggers(parsed.on ?? parsed.true);
      const category = classifyWorkflowCategory(fileBase, triggers);
      const jobsObj = parsed.jobs && typeof parsed.jobs === "object" ? parsed.jobs : {};
      const jobKeys = Object.keys(jobsObj).sort();

      wfIdByName.set(wfName, wfId);
      wfIdByName.set(fileBase, wfId);

      const runners = new Set<string>();
      let matrixJobs = 0;

      for (const jobKey of jobKeys) {
        const job = jobsObj[jobKey];
        if (!job) continue;
        const runner = normalizeRunner(job["runs-on"]);
        runners.add(runner);
        const hasMatrix = Boolean(job.strategy && job.strategy.matrix);
        if (hasMatrix) matrixJobs += 1;

        const jobId = `ci:job:${fileBase}:${jobKey}`;
        const jobLabel = typeof job.name === "string" && job.name.trim() ? job.name.trim() : jobKey;
        const needsList =
          typeof job.needs === "string"
            ? [job.needs]
            : Array.isArray(job.needs)
              ? job.needs.filter((n): n is string => typeof n === "string").sort()
              : [];

        const stepCommands = (job.steps ?? [])
          .map((s) => s.run)
          .filter((r): r is string => typeof r === "string")
          .join("\n");

        const envName =
          typeof job.environment === "string"
            ? job.environment
            : job.environment && typeof job.environment === "object" && typeof job.environment.name === "string"
              ? job.environment.name
              : null;

        nodes.push({
          id: jobId,
          domain: "ci",
          kind: "ci_job",
          label: jobLabel,
          group: fileBase,
          provenance: { file: relFile },
          tags: [
            category,
            hasMatrix ? "matrix" : "single",
            ...(envName ? [`env:${envName}`] : []),
          ],
          meta: {
            workflowId: wfId,
            jobKey,
            runner,
            hasMatrix,
            needsCount: needsList.length,
            environment: envName,
            usesReusable: typeof job.uses === "string" ? job.uses : null,
            stepCount: Array.isArray(job.steps) ? job.steps.length : 0,
            invokesVerifyGates: stepCommands.includes("verify-gates"),
          },
        });

        edges.push({
          from: wfId,
          to: jobId,
          kind: "contains",
          confidence: "observed",
          provenance: { file: relFile },
        });

        for (const depJob of needsList) {
          edges.push({
            from: jobId,
            to: `ci:job:${fileBase}:${depJob}`,
            kind: "depends_on",
            label: "needs",
            confidence: "observed",
            provenance: { file: relFile },
          });
        }
      }

      nodes.push({
        id: wfId,
        domain: "ci",
        kind: "workflow",
        label: wfName,
        group: category,
        provenance: { file: relFile, line: 1 },
        tags: [category, ...triggers],
        meta: {
          fileBase,
          category,
          triggers,
          jobCount: jobKeys.length,
          matrixJobs,
          runners: Array.from(runners).sort(),
          pathFilters: paths,
          hasConcurrency: Boolean(parsed.concurrency),
        },
      });

      for (const upstream of workflowRuns) {
        pendingWorkflowRuns.push({ from: wfId, targetName: upstream, file: relFile });
      }
    }

    for (const item of pendingWorkflowRuns) {
      const upstreamId = wfIdByName.get(item.targetName);
      if (upstreamId && upstreamId !== item.from) {
        edges.push({
          from: upstreamId,
          to: item.from,
          kind: "triggers",
          label: "workflow_run",
          confidence: "observed",
          provenance: { file: item.file },
        });
      }
    }

    const azureFiles = ctx.allFiles.filter((f) => isAzurePipelineFile(f)).sort();
    for (const relFile of azureFiles) {
      let parsed: unknown = null;
      try {
        parsed = yaml.load(fs.readFileSync(path.join(ctx.rootDir, relFile), "utf8"));
      } catch {
        continue;
      }
      if (!isAzurePipelineDoc(parsed)) continue;
      const res = parseAzurePipelineWorkflow({
        relFile,
        parsed,
        classifyCategory: classifyWorkflowCategory,
      });
      nodes.push(...res.nodes);
      edges.push(...res.edges);
    }

    const env0Files = ctx.allFiles.filter((f) => isEnv0WorkflowFile(f)).sort();
    for (const relFile of env0Files) {
      let parsed: unknown = null;
      try {
        parsed = yaml.load(fs.readFileSync(path.join(ctx.rootDir, relFile), "utf8"));
      } catch {
        continue;
      }
      const res = parseEnv0Workflow({ relFile, parsed });
      if (res) {
        nodes.push(...res.nodes);
        edges.push(...res.edges);
      }
    }

    return { nodes, edges, rules: [] };
  },
};
