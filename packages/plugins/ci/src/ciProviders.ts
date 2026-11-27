import path from "node:path";
import type { SpecEdge, SpecNode } from "@repospec/plugin";

interface AzureStep {
  script?: string;
  bash?: string;
  pwsh?: string;
  task?: string;
  displayName?: string;
  inputs?: Record<string, unknown>;
}

interface AzureJob {
  job?: string;
  deployment?: string;
  displayName?: string;
  dependsOn?: string | string[];
  pool?: string | { vmImage?: string; name?: string };
  environment?: string | { name?: string };
  steps?: AzureStep[];
  strategy?: {
    runOnce?: { deploy?: { steps?: AzureStep[] } };
    rolling?: { deploy?: { steps?: AzureStep[] } };
    canary?: { deploy?: { steps?: AzureStep[] } };
    matrix?: unknown;
  };
}

interface AzureStage {
  stage?: string;
  displayName?: string;
  dependsOn?: string | string[];
  jobs?: AzureJob[];
}

interface AzurePipelineDoc {
  name?: string;
  trigger?: unknown;
  pr?: unknown;
  schedules?: unknown;
  pool?: string | { vmImage?: string; name?: string };
  stages?: AzureStage[];
  jobs?: AzureJob[];
  steps?: AzureStep[];
  extends?: unknown;
  resources?: unknown;
}

interface Env0WorkflowDoc {
  environments?: Record<
    string,
    {
      name?: string;
      templateName?: string;
      directory?: string;
      workingDirectory?: string;
      needs?: string | string[];
      workspaceName?: string;
    }
  >;
}

function normalizeDeps(raw: string | string[] | undefined): string[] {
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string").sort();
  return [];
}

function poolNameOf(pool: string | { vmImage?: string; name?: string } | undefined): string {
  if (!pool) return "azure-hosted";
  if (typeof pool === "string") return pool;
  return pool.vmImage ?? pool.name ?? "azure-hosted";
}

function extractAzureSteps(job: AzureJob): AzureStep[] {
  if (Array.isArray(job.steps)) return job.steps;
  const strat = job.strategy;
  if (!strat) return [];
  return [
    ...(strat.runOnce?.deploy?.steps ?? []),
    ...(strat.rolling?.deploy?.steps ?? []),
    ...(strat.canary?.deploy?.steps ?? []),
  ];
}

export function isAzurePipelineFile(relFile: string): boolean {
  if (!/\.ya?ml$/i.test(relFile)) return false;
  if (relFile.startsWith(".github/workflows/")) return false;
  if (/(?:^|\/)env0\.workflow\.ya?ml$/i.test(relFile)) return false;
  return (
    /(?:^|\/)azure-pipelines(?:[-_.][^/]+)?\.ya?ml$/i.test(relFile) ||
    /^(?:\.azure-pipelines|\.azure|ci|pipelines|\.pipelines)\/.+\.ya?ml$/i.test(relFile)
  );
}

export function isEnv0WorkflowFile(relFile: string): boolean {
  return /(?:^|\/)env0\.workflow\.ya?ml$/i.test(relFile);
}

export function isAzurePipelineDoc(doc: unknown): doc is AzurePipelineDoc {
  if (!doc || typeof doc !== "object") return false;
  const rec = doc as Record<string, unknown>;
  return Boolean(
    Array.isArray(rec.stages) ||
      Array.isArray(rec.jobs) ||
      Array.isArray(rec.steps) ||
      rec.trigger !== undefined ||
      rec.pool !== undefined ||
      rec.extends !== undefined,
  );
}

export function parseAzurePipelineWorkflow(params: {
  relFile: string;
  parsed: AzurePipelineDoc;
  classifyCategory: (fileBase: string, triggers: string[]) => string;
}): { nodes: SpecNode[]; edges: SpecEdge[]; wfId: string; wfName: string } {
  const { relFile, parsed, classifyCategory } = params;
  const nodes: SpecNode[] = [];
  const edges: SpecEdge[] = [];
  const fileBase = relFile.replace(/\.ya?ml$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const wfId = `ci:wf:${fileBase}`;
  const wfName = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : path.posix.basename(relFile, path.posix.extname(relFile));

  const triggers: string[] = [];
  if (parsed.trigger !== undefined && parsed.trigger !== "none") triggers.push("push");
  if (parsed.pr !== undefined && parsed.pr !== "none") triggers.push("pull_request");
  if (Array.isArray(parsed.schedules) && parsed.schedules.length > 0) triggers.push("schedule");
  if (triggers.length === 0) triggers.push("manual");

  const category = classifyCategory(fileBase, triggers);
  const runners = new Set<string>();
  const defaultRunner = poolNameOf(parsed.pool);
  let jobCount = 0;

  const pushAzureJob = (job: AzureJob, prefix: string, stageDeps: string[]): void => {
    const rawKey = job.job ?? job.deployment ?? `job_${jobCount + 1}`;
    const jobKey = prefix ? `${prefix}_${rawKey}` : rawKey;
    const jobId = `ci:job:${fileBase}:${jobKey}`;
    const jobLabel = typeof job.displayName === "string" && job.displayName.trim() ? job.displayName.trim() : rawKey;
    const runner = poolNameOf(job.pool ?? parsed.pool) || defaultRunner;
    runners.add(runner);
    const steps = extractAzureSteps(job);
    const envName =
      typeof job.environment === "string"
        ? job.environment
        : job.environment && typeof job.environment === "object" && typeof job.environment.name === "string"
          ? job.environment.name
          : null;
    const depKeys = normalizeDeps(job.dependsOn);
    jobCount += 1;

    nodes.push({
      id: jobId,
      domain: "ci",
      kind: "ci_job",
      label: jobLabel,
      group: fileBase,
      provenance: { file: relFile },
      tags: ["azure-pipelines", category, ...(job.deployment ? ["deployment"] : []), ...(envName ? [`env:${envName}`] : [])],
      meta: {
        provider: "azure_devops",
        workflowId: wfId,
        jobKey,
        runner,
        hasMatrix: Boolean(job.strategy?.matrix),
        needsCount: depKeys.length + stageDeps.length,
        environment: envName,
        stepCount: steps.length,
      },
    });
    edges.push({
      from: wfId,
      to: jobId,
      kind: "contains",
      confidence: "observed",
      provenance: { file: relFile },
    });
    for (const dep of depKeys) {
      const targetKey = prefix ? `${prefix}_${dep}` : dep;
      edges.push({
        from: jobId,
        to: `ci:job:${fileBase}:${targetKey}`,
        kind: "depends_on",
        label: "dependsOn",
        confidence: "observed",
        provenance: { file: relFile },
      });
    }
  };

  if (Array.isArray(parsed.stages)) {
    for (const st of parsed.stages) {
      if (!st || typeof st !== "object") continue;
      const stKey = st.stage ?? "stage";
      const stDeps = normalizeDeps(st.dependsOn);
      if (Array.isArray(st.jobs) && st.jobs.length > 0) {
        for (const job of st.jobs) {
          if (job && typeof job === "object") pushAzureJob(job, stKey, stDeps);
        }
      } else {
        pushAzureJob({ job: stKey, displayName: st.displayName ?? stKey }, "", stDeps);
      }
    }
  } else if (Array.isArray(parsed.jobs)) {
    for (const job of parsed.jobs) {
      if (job && typeof job === "object") pushAzureJob(job, "", []);
    }
  } else if (Array.isArray(parsed.steps)) {
    pushAzureJob({ job: "default", displayName: wfName, steps: parsed.steps }, "", []);
  }

  nodes.push({
    id: wfId,
    domain: "ci",
    kind: "workflow",
    label: wfName,
    group: category,
    provenance: { file: relFile, line: 1 },
    tags: ["azure-pipelines", category, ...triggers],
    meta: {
      provider: "azure_devops",
      fileBase,
      category,
      triggers,
      jobCount,
      runners: Array.from(runners).sort(),
    },
  });

  return { nodes, edges, wfId, wfName };
}

export function parseEnv0Workflow(params: {
  relFile: string;
  parsed: unknown;
}): { nodes: SpecNode[]; edges: SpecEdge[]; wfId: string; wfName: string } | null {
  const { relFile, parsed } = params;
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as Env0WorkflowDoc;
  const envs = doc.environments && typeof doc.environments === "object" ? doc.environments : {};
  const envKeys = Object.keys(envs).sort();
  if (envKeys.length === 0) return null;

  const fileBase = relFile.replace(/\.ya?ml$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const wfId = `ci:wf:${fileBase}`;
  const wfName = `env0 (${path.posix.dirname(relFile) === "." ? "root" : path.posix.dirname(relFile)})`;
  const nodes: SpecNode[] = [];
  const edges: SpecEdge[] = [];
  const directories: string[] = [];

  for (const key of envKeys) {
    const envCfg = envs[key];
    if (!envCfg || typeof envCfg !== "object") continue;
    const jobId = `ci:job:${fileBase}:${key}`;
    const dir = typeof envCfg.directory === "string"
      ? envCfg.directory
      : typeof envCfg.workingDirectory === "string"
        ? envCfg.workingDirectory
        : null;
    if (dir) directories.push(dir.replace(/^\.\//, "").replace(/\/+$/, ""));
    const needs = normalizeDeps(envCfg.needs);

    nodes.push({
      id: jobId,
      domain: "ci",
      kind: "ci_job",
      label: typeof envCfg.name === "string" && envCfg.name.trim() ? envCfg.name.trim() : key,
      group: fileBase,
      provenance: { file: relFile },
      tags: ["env0", "release", "iac"],
      meta: {
        provider: "env0",
        workflowId: wfId,
        jobKey: key,
        runner: "env0",
        directory: dir,
        templateName: typeof envCfg.templateName === "string" ? envCfg.templateName : null,
        needsCount: needs.length,
      },
    });
    edges.push({
      from: wfId,
      to: jobId,
      kind: "contains",
      confidence: "observed",
      provenance: { file: relFile },
    });
    for (const dep of needs) {
      edges.push({
        from: jobId,
        to: `ci:job:${fileBase}:${dep}`,
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
    group: "release",
    provenance: { file: relFile, line: 1 },
    tags: ["env0", "release", "iac"],
    meta: {
      provider: "env0",
      fileBase,
      category: "release",
      triggers: ["iac_workflow"],
      jobCount: envKeys.length,
      runners: ["env0"],
      iacDirectories: Array.from(new Set(directories)).sort(),
    },
  });

  return { nodes, edges, wfId, wfName };
}
