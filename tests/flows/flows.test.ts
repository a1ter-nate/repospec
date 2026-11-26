import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepo } from "@repospec/core";
import { analyzeRepoFlows, analyzeRepoFlowsWithPlugins, applyTelemetryOverlay, loadTelemetryOverlay } from "@repospec/flows";
import { defineFlowLanguage } from "@repospec/flows/languages";
import {
  renderAsyncHandoffsSvg,
  renderDataHubSvg,
  renderFlowsHtmlReport,
  renderStateMachineSvg,
  renderWorkFlowSwimlaneSvg,
} from "@repospec/flows/svg";
import { renderReportHtml } from "@repospec/report";

let tmpRoot = "";
let repoDir = "";

function writeFile(rel: string, content: string): void {
  const abs = path.join(repoDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "repospec-flows-test-"));
  repoDir = path.join(tmpRoot, "sample-iot");
  fs.mkdirSync(repoDir, { recursive: true });

  writeFile(
    "package.json",
    JSON.stringify({ name: "sample-iot", version: "1.0.0", type: "module" }, null, 2),
  );

  writeFile(
    ".repospec/flows.yaml",
    `journeys:
  - id: iot-device-poll
    name: IoT Device Poll (/getUpdates)
    entryFile: src/controller/updates.ts
    entryFn: getUpdates
    tags: ["iot", "critical-path"]
`,
  );

  writeFile(
    "src/controller/updates.ts",
    `export async function getUpdates(req: { body: { uuid: string } }, res: { status: (c: number) => { json: (v: unknown) => void } }) {
  const dev = await deviceService.getDeviceByUUID(req.body.uuid);
  await deviceService.updateDeviceApiInfo(dev.id, "/getUpdates");
  await resolveDeviceTimezone(dev.id);
  await handleFirmwareCheck(dev.id);
  await cartridgeService.getMostRecentCartridgeById(dev.id);
  await captureUpdatesResponse(dev.id);
  res.status(200).json({ ok: true });
}
`,
  );

  writeFile(
    "src/controller/status.ts",
    `export async function saveStatus(req: { body: { uuid: string } }, res: { status: (c: number) => { send: (v: unknown) => void } }) {
  const dev = await deviceService.getDeviceByUUID(req.body.uuid);
  await deviceService.sendStatusUpdateNotification(dev);
  cacheService.deleteCacheEntry(dev.id, "device");
  await deviceService.updateDeviceStatus(dev.id, { internalHidden: false, status: "ok" });
  res.status(200).send({ ok: true });
}
`,
  );

  writeFile(
    "src/service/visibilityA.ts",
    `export async function hideDevice(id: string) {
  await deviceDao.updateDevice(id, { internalHidden: true });
}
`,
  );

  writeFile(
    "src/service/visibilityB.ts",
    `export async function setupDevice(id: string) {
  await deviceDao.updateDevice(id, { internalHidden: false });
}
`,
  );

  writeFile(
    "src/util/deviceHealth.ts",
    `export function deriveDeviceHealth(device: { internalHidden: boolean; status: string }) {
  return !device.internalHidden && device.status === "ok";
}
`,
  );

  writeFile(
    "src/util/deviceLifecycle.ts",
    `const ALLOWED_TRANSITIONS = {
  pre_build: ["build", "retired"],
  build: ["qc", "retired"],
  qc: ["storage", "retired"],
  storage: ["shipped_out", "retired"],
  shipped_out: ["in_service", "retired"],
  in_service: ["retired"],
  retired: [],
} as const;

const GUARDS = {
  build: { qc: ["uuid", "serialNumber"] },
  qc: { storage: ["qcApproved"] },
};
export { ALLOWED_TRANSITIONS, GUARDS };
`,
  );

  writeFile(
    "src/dao/captureMachine.ts",
    `const CapturePhase = {
  Pending: "pending",
  Captured: "captured",
  Cancelled: "cancelled",
  Expired: "expired",
} as const;

export function transitionCapture(phase: string, event: { type: "capture" | "cancel" | "expire" }) {
  switch (event.type) {
    case "capture":
      return { phase: CapturePhase.Captured };
    case "cancel":
      return { phase: CapturePhase.Cancelled };
    case "expire":
      return { phase: CapturePhase.Expired };
  }
}
`,
  );

  writeFile(
    "android/DeviceStatusChangeListenerImpl.kt",
    `class DeviceStatusChangeListenerImpl {
  fun onMessage() {}
}
`,
  );

  writeFile(
    "infra/scheduler.tf",
    `resource "google_cloud_scheduler_job" "nightly_drift" {
  http_target {
    uri = "https://api.example.com/internal/drift"
  }
}
`,
  );
});

afterAll(() => {
  if (tmpRoot && fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

describe("@repospec/flows — Work Flows, Data Lifecycles, State Machines, Async Stitching, Telemetry & SVGs", () => {
  test("extracts ordered flows, DDIA hazards, entity multi-writer lifecycles, state machines, async handoffs, and applies telemetry overlay", () => {
    const bundle = analyzeRepoFlows(repoDir);

    const pollFlow = bundle.workFlows.find((f) => f.id === "iot-device-poll");
    expect(pollFlow).toBeDefined();
    expect(pollFlow?.triggerKind).toBe("journey");
    expect(pollFlow?.tags).toContain("critical-path");
    expect(pollFlow?.hazards.some((h) => h.kind === "write_on_poll")).toBe(true);
    expect(pollFlow?.hazards.some((h) => h.kind === "blocking_noncritical_io")).toBe(true);

    const statusFlow = bundle.workFlows.find((f) => f.name === "saveStatus");
    expect(statusFlow).toBeDefined();
    expect(statusFlow?.hazards.some((h) => h.kind === "notify_before_commit")).toBe(true);
    expect(statusFlow?.hazards.some((h) => h.kind === "invalidate_before_write")).toBe(true);

    const hiddenField = bundle.entityLifecycles.find((l) => l.field === "internalHidden");
    expect(hiddenField).toBeDefined();
    expect(hiddenField?.multiWriterRisk).toBe(true);
    expect(hiddenField?.derivedOnRead).toBe(true);

    const smNames = bundle.stateMachines.map((m) => m.name);
    expect(smNames).toContain("deviceLifecycle");
    expect(smNames).toContain("captureMachine");
    const lcSm = bundle.stateMachines.find((m) => m.name === "deviceLifecycle");
    expect(lcSm?.transitions.some((t) => t.from === "build" && t.to === "qc" && t.guard === "uuid+serialNumber")).toBe(true);

    const fcmHandoff = bundle.asyncHandoffs.find((a) => a.transport === "fcm");
    expect(fcmHandoff).toBeDefined();
    expect(fcmHandoff?.consumer?.fn).toBe("DeviceStatusChangeListenerImpl");
    expect(bundle.asyncHandoffs.some((a) => a.transport === "cron")).toBe(true);

    const traceFile = path.join(tmpRoot, "otel-sample.json");
    fs.writeFileSync(
      traceFile,
      JSON.stringify({
        spans: [
          { fn: "getUpdates", p50Ms: 140, p95Ms: 480, rps: 62 },
          { fn: "resolveDeviceTimezone", p50Ms: 95, p95Ms: 310 },
        ],
      }),
    );
    const overlaid = applyTelemetryOverlay(bundle.workFlows, loadTelemetryOverlay(traceFile));
    const pollOverlaid = overlaid.find((f) => f.id === "iot-device-poll");
    expect(pollOverlaid?.telemetry?.p95Ms).toBe(480);
    expect(pollOverlaid?.steps.some((s) => s.fn === "resolveDeviceTimezone" && s.latencyMsP95 === 310)).toBe(true);

    if (!pollOverlaid || !statusFlow || !hiddenField || !lcSm) {
      throw new Error("Expected extracted flow artifacts to be present");
    }
    expect(renderWorkFlowSwimlaneSvg(pollOverlaid)).toContain("BLOCKING CRITICAL PATH");
    expect(renderWorkFlowSwimlaneSvg(pollOverlaid)).toContain("data-flow-step=");
    expect(renderWorkFlowSwimlaneSvg(pollOverlaid, { mode: "optimized" })).toContain("OPTIMIZED CRITICAL PATH");
    expect(renderWorkFlowSwimlaneSvg(statusFlow)).toContain("RACE WINDOW BEFORE COMMIT");
    expect(renderWorkFlowSwimlaneSvg(statusFlow, { mode: "optimized" })).not.toContain("RACE WINDOW BEFORE COMMIT");
    expect(renderDataHubSvg(hiddenField.entity, [hiddenField])).toContain("data-hub-field=");
    expect(renderStateMachineSvg(lcSm)).toContain("data-sm-state=");
    expect(renderAsyncHandoffsSvg(bundle.asyncHandoffs)).toContain("data-async-idx=");
    const standaloneHtml = renderFlowsHtmlReport(bundle, "Sample Flows", { repoDir });
    const dataMatch = standaloneHtml.match(/<script id="flow-data" type="application\/json">([\s\S]*?)<\/script>/);
    const standaloneData = JSON.parse(dataMatch?.[1] ?? "{}") as {
      workFlows: Array<{ svg: string; optimizedSvg: string }>;
      sources: Record<string, string[]>;
    };
    expect(standaloneData.workFlows[0]?.svg).toContain("<svg");
    expect(standaloneData.workFlows[0]?.optimizedSvg).toContain("OPTIMIZED CRITICAL PATH");
    expect(JSON.stringify(standaloneData.sources)).toContain("getDeviceByUUID");
    const standaloneScripts = [...standaloneHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const standaloneApp = standaloneScripts[standaloneScripts.length - 1]?.[1] ?? "";
    expect(() => new Function(standaloneApp)).not.toThrow();
  });

  test("wires flow extractor, DDIA SQL invariants, and Studio Flows tab end-to-end", async () => {
    const dbPath = path.join(tmpRoot, "flows-e2e.sqlite");
    const res = await scanRepo(repoDir, { dbPath });
    expect(res.spec.stateMachines.length).toBeGreaterThanOrEqual(2);
    expect(res.spec.extensions.facts.some((f) => f.kind === "work_flow")).toBe(true);
    expect(res.spec.extensions.facts.some((f) => f.kind === "ddia_hazard")).toBe(true);

    const ddiaIds = new Set(res.spec.invariants.filter((i) => i.id.startsWith("ddia:") && i.status === "warn").map((i) => i.id));
    expect(ddiaIds.has("ddia:notify-before-commit")).toBe(true);
    expect(ddiaIds.has("ddia:invalidate-before-write")).toBe(true);
    expect(ddiaIds.has("ddia:write-on-poll")).toBe(true);
    expect(ddiaIds.has("ddia:blocking-noncritical-io")).toBe(true);
    expect(ddiaIds.has("ddia:multi-writer-unowned-field")).toBe(true);

    const html = renderReportHtml({ spec: res.spec, digest: res.digest, inline: false });
    expect(html).toContain("renderFlowsTab");
    expect(html).toContain("RACE WINDOW BEFORE COMMIT");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const appScript = scripts[scripts.length - 1]?.[1] ?? "";
    expect(() => new Function(appScript)).not.toThrow();
  });

  test("extracts Rust, C#, and custom language-plugin flows, data lifecycles, statecharts, and cross-language async handoffs", async () => {
    const polyDir = path.join(tmpRoot, "polyglot-flows");
    fs.mkdirSync(polyDir, { recursive: true });
    const put = (rel: string, body: string): void => {
      const abs = path.join(polyDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body, "utf8");
    };

    put(
      "services/rust-iot/src/handler.rs",
      `pub enum DeviceState {
  Pending,
  Active,
  Retired,
}

pub fn advance(s: DeviceState, verified: bool) -> DeviceState {
  match s {
    DeviceState::Pending if verified => DeviceState::Active,
    DeviceState::Active => DeviceState::Retired,
    _ => DeviceState::Retired,
  }
}

pub async fn update_device_status(id: &str) -> Result<Json<()>, ()> {
  let _dev = get_device(id).await?;
  send_status_notification(id).await?;
  cache.del(id).await?;
  sqlx::query("UPDATE devices SET status = $1, synced_at = $2 WHERE id = $3").execute(pool).await?;
  tx.commit().await?;
  publish("device-sync").await?;
  Ok(Json(()))
}
`,
    );

    put(
      "services/dotnet-api/Controllers/DeviceController.cs",
      `public enum OrderState {
  Draft,
  Paid,
  Shipped,
  Cancelled,
}

public class OrderMachine {
  public OrderState Next(OrderState s, bool hasStock) => s switch {
    OrderState.Draft when hasStock => OrderState.Paid,
    OrderState.Paid => OrderState.Shipped,
    _ => OrderState.Cancelled,
  };
}

public class DeviceSyncConsumer : IConsumer<DeviceSync> {}

public class DeviceController {
  public async Task<IActionResult> SaveDeviceAsync(string id) {
    var device = await _repo.GetDeviceAsync(id);
    await _notifier.SendStatusNotificationAsync(id);
    await _cache.RemoveAsync(id);
    device.Status = "ready";
    await _db.SaveChangesAsync();
    await _bus.Publish<DeviceSync>(new DeviceSync());
    return Ok(device);
  }
}
`,
    );

    put("services/go-worker/handler.go", `func Sync(w http.ResponseWriter) { db.Query(); db.Exec(); }`);

    const customGoPlugin = defineFlowLanguage({
      id: "go-test",
      label: "Go Test",
      extensions: [".go"],
      extractFlows(ctx) {
        return [
          {
            id: `flow:go:${ctx.relFile}:Sync`,
            name: "Sync",
            entryFn: "Sync",
            triggerKind: "http",
            file: ctx.relFile,
            line: 1,
            unit: ctx.unitSlug,
            steps: [
              { index: 0, fn: "db.Query", op: "db_read", lane: "datastore", file: ctx.relFile, line: 1, afterResponse: false, bestEffort: false },
              { index: 1, fn: "db.Exec", op: "tx_commit", lane: "datastore", file: ctx.relFile, line: 1, afterResponse: false, bestEffort: false },
            ],
            responseStepIndex: null,
            commitStepIndex: 1,
            serialAwaitCount: 2,
            hazards: [],
          },
        ];
      },
    });

    const bundle = await analyzeRepoFlowsWithPlugins(polyDir, { extraLanguages: [customGoPlugin] });

    const rustFlow = bundle.workFlows.find((f) => f.name === "update_device_status");
    expect(rustFlow).toBeDefined();
    expect(rustFlow?.hazards.some((h) => h.kind === "notify_before_commit")).toBe(true);
    expect(rustFlow?.hazards.some((h) => h.kind === "invalidate_before_write")).toBe(true);

    const csFlow = bundle.workFlows.find((f) => f.name === "SaveDeviceAsync");
    expect(csFlow).toBeDefined();
    expect(csFlow?.hazards.some((h) => h.kind === "notify_before_commit")).toBe(true);
    expect(csFlow?.hazards.some((h) => h.kind === "invalidate_before_write")).toBe(true);

    expect(bundle.workFlows.some((f) => f.name === "Sync" && f.file.endsWith(".go"))).toBe(true);

    const smNames = bundle.stateMachines.map((m) => m.name);
    expect(smNames).toContain("DeviceState");
    expect(smNames).toContain("OrderState");
    expect(bundle.stateMachines.find((m) => m.name === "DeviceState")?.transitions.some((t) => t.guard === "verified")).toBe(true);
    expect(bundle.stateMachines.find((m) => m.name === "OrderState")?.transitions.some((t) => t.guard === "hasStock")).toBe(true);

    expect(bundle.asyncHandoffs.some((a) => a.producer.language === "csharp" && a.consumer?.fn === "DeviceSyncConsumer")).toBe(true);
    expect(bundle.asyncHandoffs.some((a) => a.producer.language === "rust" && a.channel === "queue:device-sync")).toBe(true);
  });
});
