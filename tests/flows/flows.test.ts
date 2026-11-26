import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepo } from "@repospec/core";
import { analyzeRepoFlows, applyTelemetryOverlay, loadTelemetryOverlay } from "@repospec/flows";
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
    expect(renderWorkFlowSwimlaneSvg(statusFlow)).toContain("RACE WINDOW BEFORE COMMIT");
    expect(renderDataHubSvg(hiddenField.entity, [hiddenField])).toContain("multi-writer risk");
    expect(renderStateMachineSvg(lcSm)).toContain("uuid+serialNumber");
    expect(renderAsyncHandoffsSvg(bundle.asyncHandoffs)).toContain("DeviceStatusChangeListenerImpl");
    expect(renderFlowsHtmlReport(bundle, "Sample Flows")).toContain("<svg");
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
});
