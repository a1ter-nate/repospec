import fs from "node:fs";
import path from "node:path";
import type { ExtractorPlugin, GraphFragment, IacPlane, LoopRecord, RepoContext, SpecEdge, SpecNode, SpecRule } from "@repospec/plugin";

const DEPLOYABLE_COMPUTE_EXACT = new Set([
  "azurerm_container_app",
  "azurerm_container_app_job",
  "azurerm_linux_web_app",
  "azurerm_windows_web_app",
  "azurerm_app_service",
  "azurerm_linux_function_app",
  "azurerm_windows_function_app",
  "azurerm_function_app",
  "azurerm_function_app_flex_consumption",
  "azurerm_spring_cloud_app",
  "azurerm_kubernetes_cluster",
  "azurerm_virtual_machine",
  "azurerm_linux_virtual_machine",
  "azurerm_windows_virtual_machine",
  "azurerm_batch_pool",
  "aws_ecs_service",
  "aws_ecs_task_definition",
  "aws_lambda_function",
  "aws_apprunner_service",
  "aws_instance",
  "aws_autoscaling_group",
  "aws_eks_cluster",
  "aws_batch_job_definition",
  "google_cloud_run_v2_service",
  "google_cloud_run_v2_job",
  "google_cloud_run_service",
  "google_cloudfunctions_function",
  "google_cloudfunctions2_function",
  "google_compute_instance",
  "google_container_cluster",
  "google_app_engine_standard_app_version",
  "kubernetes_deployment",
  "kubernetes_stateful_set",
  "kubernetes_cron_job_v1",
  "helm_release",
]);

export function isDeployableComputeResource(resourceType: string): boolean {
  const t = resourceType.toLowerCase();
  if (DEPLOYABLE_COMPUTE_EXACT.has(t)) return true;
  if (/^azurerm_(?:linux|windows)_function_app/.test(t)) return true;
  if (/^azurerm_(?:linux|windows)_web_app/.test(t)) return true;
  if (/^google_cloud_run_v\d+_(?:service|job)$/.test(t)) return true;
  return false;
}

export function classifyTerraformPlane(resourceType: string, fileBase: string): IacPlane {
  const t = resourceType.toLowerCase();
  const f = fileBase.toLowerCase();
  if (
    f.includes("ci_runner") ||
    f.includes("turbo_cache") ||
    t.startsWith("github_actions") ||
    t.startsWith("azuredevops_") ||
    t.startsWith("env0_")
  ) {
    return "ci_infra";
  }
  if (isDeployableComputeResource(t)) {
    return "compute";
  }
  if (
    t.startsWith("azuread_") ||
    t.includes("role_assignment") ||
    t.includes("role_definition") ||
    t.includes("key_vault") ||
    t.includes("managed_identity") ||
    t.includes("user_assigned_identity") ||
    t.includes("iam") ||
    t.includes("secret") ||
    t.includes("service_account") ||
    t.includes("certificate") ||
    t.includes("ssl") ||
    t.includes("firewall") ||
    t.includes("security_policy") ||
    t.includes("security_group") ||
    t.includes("policy_assignment") ||
    t.includes("waf") ||
    t.includes("kms")
  ) {
    return "security";
  }
  if (
    t.includes("application_insights") ||
    t.includes("log_analytics") ||
    t.includes("monitor_") ||
    t.includes("monitoring") ||
    t.includes("logging") ||
    t.includes("uptime") ||
    t.includes("alert") ||
    t.includes("dashboard") ||
    t.includes("workbook") ||
    t.includes("cloudwatch") ||
    t.includes("datadog") ||
    f.includes("canaries")
  ) {
    return "observability";
  }
  if (
    t.includes("eventhub") ||
    t.includes("servicebus") ||
    t.includes("iothub") ||
    t.includes("eventgrid") ||
    t.includes("pubsub") ||
    t.includes("sqs") ||
    t.includes("sns") ||
    t.includes("kafka") ||
    t.includes("msk_") ||
    t.includes("kinesis") ||
    t.includes("rabbitmq") ||
    t.includes("queue")
  ) {
    return "messaging";
  }
  if (
    t.includes("container_app_environment_storage") ||
    t.includes("storage_account") ||
    t.includes("storage_container") ||
    t.includes("storage_blob") ||
    t.includes("storage_share") ||
    t.includes("storage_bucket") ||
    t.includes("firestore") ||
    t.includes("sql") ||
    t.includes("postgres") ||
    t.includes("mysql") ||
    t.includes("cosmosdb") ||
    t.includes("dynamodb") ||
    t.includes("rds_") ||
    t.includes("db_instance") ||
    t.includes("redis") ||
    t.includes("elasticache") ||
    t.includes("bigquery") ||
    t.includes("artifact_registry") ||
    t.includes("container_registry") ||
    t.includes("s3_bucket") ||
    t.includes("database")
  ) {
    return "data";
  }
  if (
    t.includes("container_app_custom_domain") ||
    t.includes("container_app_environment") ||
    t.includes("compute_url_map") ||
    t.includes("backend_service") ||
    t.includes("forwarding_rule") ||
    t.includes("virtual_network") ||
    t.includes("network") ||
    t.includes("subnet") ||
    t.includes("dns") ||
    t.includes("vpc") ||
    t.includes("neg") ||
    t.includes("target_https_proxy") ||
    t.includes("target_http_proxy") ||
    t.includes("global_address") ||
    t.includes("load_balancer") ||
    t.includes("frontdoor") ||
    t.includes("cdn_") ||
    t.includes("nat_gateway") ||
    t.includes("private_endpoint") ||
    t.includes("public_ip") ||
    t.includes("route_table") ||
    t.includes("api_management") ||
    t.includes("ingress") ||
    t.includes("gateway")
  ) {
    return "network";
  }
  if (
    t.includes("resource_group") ||
    t.includes("consumption_budget") ||
    t.includes("budget") ||
    t.includes("management_lock") ||
    t.includes("subscription") ||
    t.includes("cost_management") ||
    t.includes("project_service") ||
    t.startsWith("random_") ||
    t.startsWith("null_") ||
    t.startsWith("time_") ||
    t === "terraform_data"
  ) {
    return "governance";
  }
  return "governance";
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function extractTopLevelStringAttr(body: string, attrName: string): string | null {
  const escapedAttr = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attrRe = new RegExp(`^${escapedAttr}\\s*=\\s*"([^"]+)"`);
  let depth = 0;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (depth === 0) {
      const m = trimmed.match(attrRe);
      if (m?.[1]) return m[1];
    }
    for (const ch of trimmed) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  return null;
}

export const iacExtractor: ExtractorPlugin = {
  id: "iac.terraform-docker-firebase.v4",
  domain: "iac",
  async extract(ctx: RepoContext): Promise<GraphFragment> {
    const nodes: SpecNode[] = [];
    const edges: SpecEdge[] = [];
    const rules: SpecRule[] = [];
    const loops: LoopRecord[] = [];

    const tfFiles = ctx.allFiles.filter((f) => f.endsWith(".tf")).sort();
    const tfBodies: Array<{ id: string; relFile: string; body: string }> = [];
    const tfAddressToId = new Map<string, string>();

    for (const relFile of tfFiles) {
      const absFile = path.join(ctx.rootDir, relFile);
      let text: string;
      try {
        text = fs.readFileSync(absFile, "utf8");
      } catch {
        continue;
      }

      const fileBase = path.posix.basename(relFile, ".tf");
      const resRegex = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
      let match: RegExpExecArray | null = resRegex.exec(text);
      while (match !== null) {
        const resType = match[1];
        const resName = match[2];
        if (resType && resName) {
          const address = `${resType}.${resName}`;
          const id = `iac:tf:${address}`;
          const plane = classifyTerraformPlane(resType, fileBase);
          const deployableCompute = isDeployableComputeResource(resType);
          const line = lineOf(text, match.index);

          const startIdx = match.index + match[0].length;
          let depth = 1;
          let endIdx = startIdx;
          while (endIdx < text.length && depth > 0) {
            const ch = text[endIdx];
            if (ch === "{") depth += 1;
            else if (ch === "}") depth -= 1;
            endIdx += 1;
          }
          const body = text.slice(startIdx, Math.max(startIdx, endIdx - 1));

          const topName = extractTopLevelStringAttr(body, "name");
          const displayName = topName ? `${resName} (${topName})` : resName;

          if (resType === "google_cloud_scheduler_job" || resType === "azurerm_container_app_job") {
            const sched = extractTopLevelStringAttr(body, "schedule") ?? extractTopLevelStringAttr(body, "cron_expression");
            loops.push({
              id: `arch:loop:tf:${resName}`,
              name: topName ?? resName,
              kind: "scheduler",
              schedule: sched,
              unit: fileBase,
              provenance: { file: relFile, line },
            });
          }

          nodes.push({
            id,
            domain: "iac",
            kind: "iac_resource",
            label: displayName,
            group: plane,
            provenance: { file: relFile, line },
            tags: ["terraform", plane, fileBase, ...(deployableCompute ? ["deployable_compute"] : [])],
            meta: {
              provider: resType.split("_")[0] ?? "terraform",
              resourceType: resType,
              resourceName: resName,
              address,
              plane,
              deployableCompute,
              tfFile: fileBase,
              cloudName: topName,
              usesApiImage: body.includes("google_cloud_run_v2_service.api"),
            },
          });

          tfAddressToId.set(address, id);
          tfBodies.push({ id, relFile, body });
        }
        match = resRegex.exec(text);
      }
    }

    for (const item of tfBodies) {
      for (const [address, targetId] of tfAddressToId) {
        if (targetId === item.id) continue;
        if (item.body.includes(address)) {
          edges.push({
            from: item.id,
            to: targetId,
            kind: "references",
            label: "tf-ref",
            confidence: "observed",
            provenance: { file: item.relFile },
            evidence: [{ file: item.relFile, detail: `references ${address}` }],
          });
        }
      }
    }

    const dockerFiles: string[] = [];
    let firestoreRules: string | undefined;
    let firestoreIndexes: string | undefined;
    for (const rel of ctx.allFiles) {
      if (/(?:^|\/)Dockerfile(?:\.[A-Za-z0-9_-]+)?$/.test(rel)) {
        dockerFiles.push(rel);
      }
      if (!firestoreRules && rel.endsWith("firestore.rules")) {
        firestoreRules = rel;
      }
      if (!firestoreIndexes && rel.endsWith("firestore.indexes.json")) {
        firestoreIndexes = rel;
      }
    }
    dockerFiles.sort();

    for (const relFile of dockerFiles) {
      const id = `iac:docker:${relFile}`;
      const parentDir = path.posix.dirname(relFile);
      const isTestContainer = relFile.startsWith("tests/");
      const plane: IacPlane = isTestContainer ? "ci_infra" : "compute";
      nodes.push({
        id,
        domain: "iac",
        kind: "iac_container",
        label: relFile,
        group: plane,
        provenance: { file: relFile, line: 1 },
        tags: ["docker", plane],
        meta: {
          plane,
          dir: parentDir,
        },
      });
    }

    if (firestoreRules) {
      const id = `iac:firebase:${firestoreRules}`;
      nodes.push({
        id,
        domain: "iac",
        kind: "iac_datastore_rule",
        label: "Firestore Security Rules",
        group: "security",
        provenance: { file: firestoreRules, line: 1 },
        tags: ["firebase", "security"],
        meta: { plane: "security" },
      });
      rules.push({
        id: "rule:security:firestore-rules",
        name: "firestore-security-rules",
        category: "security_rule",
        enforcement: "static",
        rung: "R4",
        statement: `Firestore authorization rules defined in ${firestoreRules}`,
        targets: [id],
        provenance: { file: firestoreRules, line: 1 },
      });
    }

    if (firestoreIndexes) {
      let indexCount = 0;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(ctx.rootDir, firestoreIndexes), "utf8")) as {
          indexes?: unknown[];
        };
        indexCount = Array.isArray(parsed.indexes) ? parsed.indexes.length : 0;
      } catch {
        indexCount = 0;
      }
      nodes.push({
        id: `iac:firebase:${firestoreIndexes}`,
        domain: "iac",
        kind: "iac_datastore_rule",
        label: `Firestore Indexes (${indexCount})`,
        group: "data",
        provenance: { file: firestoreIndexes, line: 1 },
        tags: ["firebase", "data"],
        meta: { plane: "data", indexCount },
      });
    }

    return { nodes, edges, rules, loops };
  },
};
