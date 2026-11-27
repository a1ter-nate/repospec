import { describe, expect, test } from "bun:test";
import { buildChecksModel, classifyCheckTier, FIX_NEXT_HIT_LIMIT } from "@repospec/plugin-studio";
import type { ChecksSpecInput } from "@repospec/plugin-studio";

describe("checksModel triage tiers, verdict, and places", () => {
  test("classifyCheckTier partitions fail, warn <= 12, warn > 12, info, and pass/na", () => {
    expect(classifyCheckTier({ status: "fail", severity: "error", violationCount: 2 })).toBe("broken");
    expect(classifyCheckTier({ status: "warn", severity: "warn", violationCount: 1 })).toBe("fix_next");
    expect(classifyCheckTier({ status: "warn", severity: "warn", violationCount: FIX_NEXT_HIT_LIMIT })).toBe("fix_next");
    expect(classifyCheckTier({ status: "warn", severity: "warn", violationCount: FIX_NEXT_HIT_LIMIT + 1 })).toBe("patterns");
    expect(classifyCheckTier({ status: "warn", severity: "info", violationCount: 138 })).toBe("housekeeping");
    expect(classifyCheckTier({ status: "pass", severity: "error", violationCount: 0 })).toBe("holding");
    expect(classifyCheckTier({ status: "na", severity: "error", violationCount: 0 })).toBe("holding");
  });

  test("ranks surgical fixes ahead of large patterns, builds verdict, and surfaces multi-check places", () => {
    const spec: ChecksSpecInput = {
      invariants: [
        {
          id: "sql:env-contract-drift",
          name: "Env Drift",
          rung: "R4",
          severity: "info",
          status: "warn",
          sqlFile: "rules/12-env-contract-drift.sql",
          statement: "Env vars should be declared.",
          why: "Undeclared env vars break deploys.",
          fix: "Add to .env.example.",
          violationCount: 138,
          evidence: [{ file: "apps/cloud-api/app.ts", line: 10, subject: "FOO", detail: "FOO undeclared" }],
        },
        {
          id: "ddia:serial-independent-awaits",
          name: "Serial Awaits",
          rung: "R2",
          severity: "warn",
          status: "warn",
          sqlFile: "rules/17-serial.sql",
          statement: "Run independent awaits concurrently.",
          why: "Adds tail latency.",
          fix: "Use Promise.all.",
          violationCount: 77,
          evidence: [{ file: "apps/cloud-api/controller/status.ts", line: 40, subject: "saveStatus", detail: "3 serial awaits" }],
        },
        {
          id: "ddia:notify-before-commit",
          name: "Notify Before Commit",
          rung: "R2",
          severity: "warn",
          status: "warn",
          sqlFile: "rules/15-notify.sql",
          statement: "Notify after commit.",
          why: "Race window before write.",
          fix: "Move notify after write.",
          violationCount: 2,
          evidence: [
            { file: "apps/cloud-api/controller/status.ts", line: 87, subject: "saveStatus", detail: "notify at 87 before write at 102" },
          ],
        },
        {
          id: "sql:layer-inversion",
          name: "Layer Inversion",
          rung: "R1",
          severity: "error",
          status: "fail",
          sqlFile: "rules/03-layer.sql",
          statement: "Lower layers must not import upper layers.",
          why: "Creates cycles.",
          fix: "Extract shared contract.",
          violationCount: 2,
          evidence: [
            { file: "apps/cloud-api/client/auth.ts", line: 9, subject: "client->dao", detail: "client imports dao" },
          ],
        },
        {
          id: "sql:workspace-cycles",
          name: "Acyclic Workspace",
          rung: "R1",
          severity: "error",
          status: "pass",
          sqlFile: "rules/09-cycles.sql",
          statement: "No workspace cycles.",
          why: "Keeps builds clean.",
          fix: "Break cycle.",
          violationCount: 0,
          evidence: [],
        },
      ],
    };

    const cm = buildChecksModel(spec, [{ id: "wf:saveStatus", file: "apps/cloud-api/controller/status.ts" }], {
      files: [{ p: "apps/cloud-api/controller/status.ts" }, { p: "apps/cloud-api/client/auth.ts" }],
    });

    expect(cm.counts.broken).toBe(1);
    expect(cm.counts.fixNext).toBe(1);
    expect(cm.counts.patterns).toBe(1);
    expect(cm.counts.housekeeping).toBe(1);
    expect(cm.counts.passed).toBe(1);
    expect(cm.verdict).toBe("1 rule broken in 2 places. 1 small fix. 1 pattern and 1 chore can wait.");
    expect(cm.items.map((i) => i.id)).toEqual([
      "sql:layer-inversion",
      "ddia:notify-before-commit",
      "ddia:serial-independent-awaits",
      "sql:env-contract-drift",
      "sql:workspace-cycles",
    ]);
    expect(cm.defaultCheckId).toBe("sql:layer-inversion");
    expect(cm.places.length).toBe(1);
    expect(cm.places[0]?.file).toBe("apps/cloud-api/controller/status.ts");
    expect(cm.places[0]?.checkCount).toBe(2);
    expect(cm.items.find((i) => i.id === "sql:env-contract-drift")?.jumpTarget?.kind).toBe("surfaces_config");
    expect(cm.items.find((i) => i.id === "ddia:notify-before-commit")?.jumpTarget?.kind).toBe("flows");
  });
});
