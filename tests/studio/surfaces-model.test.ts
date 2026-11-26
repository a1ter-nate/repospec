import { describe, expect, test } from "bun:test";
import {
  buildSurfacesModel,
  classifyEndpointGuard,
  normalizeEntityKey,
  type SurfacesSpecInput,
} from "../../src/internal/render/surfacesModel.ts";

describe("surfacesModel truth shaping", () => {
  test("normalizeEntityKey aligns plural hubs with singular entity names without mangling status/access", () => {
    expect(normalizeEntityKey("devices")).toBe("device");
    expect(normalizeEntityKey("device")).toBe("device");
    expect(normalizeEntityKey("properties")).toBe("property");
    expect(normalizeEntityKey("propertys")).toBe("property");
    expect(normalizeEntityKey("companies")).toBe("company");
    expect(normalizeEntityKey("status")).toBe("status");
    expect(normalizeEntityKey("access")).toBe("access");
  });

  test("classifyEndpointGuard splits guarded, public, and unknown and shortens multiline AST guards", () => {
    expect(classifyEndpointGuard(null)).toEqual({ guardClass: "unknown", guardName: "", guardExpr: null });
    expect(classifyEndpointGuard("public")).toEqual({ guardClass: "public", guardName: "public", guardExpr: null });
    expect(classifyEndpointGuard("bearerAuth")).toEqual({ guardClass: "guarded", guardName: "bearerAuth", guardExpr: null });
    const complex = classifyEndpointGuard("requireBearerAuth({\n  role: 'admin'\n})");
    expect(complex.guardClass).toBe("guarded");
    expect(complex.guardName).toBe("requireBearerAuth");
    expect(complex.guardExpr).toContain("role: 'admin'");
  });

  test("dedupes contract copies, joins plural hubs, excludes CI built-ins from drift, and avoids fake shared root unit", () => {
    const spec: SurfacesSpecInput = {
      repo: { name: "@demo/platform" },
      nodes: [
        { kind: "app", label: "@demo/cloud-api" },
        { kind: "app", label: "@demo/web" },
      ],
      invariants: [
        {
          id: "sql:multi-domain-entity-ownership",
          status: "warn",
          evidence: [{ subject: "firestore:samples", file: "a.ts", line: 1, detail: "shared" }],
        },
      ],
      entities: [
        {
          datastore: "firestore",
          entity: "device",
          totalRefs: 145,
          domains: ["devices", "billing", "operations"],
          layers: ["dao"],
          sampleFiles: ["apps/cloud-api/dao/device.ts"],
          declared: true,
          authorizedShared: true,
          hasBypass: false,
          fkCount: 0,
          hasTenancyKey: false,
        },
        {
          datastore: "firestore",
          entity: "samples",
          totalRefs: 16,
          domains: ["billing", "devices", "qc"],
          layers: ["dao"],
          sampleFiles: [],
          declared: false,
          authorizedShared: false,
          hasBypass: false,
          fkCount: 0,
          hasTenancyKey: false,
        },
        {
          datastore: "firestore",
          entity: "tinyNote",
          totalRefs: 1,
          domains: ["support"],
          layers: ["dao"],
          sampleFiles: [],
          declared: false,
          authorizedShared: false,
          hasBypass: false,
          fkCount: 0,
          hasTenancyKey: false,
        },
      ],
      surfaces: {
        endpoints: [
          { unit: "@demo/platform", method: "GET", path: "/partner/devices", authGuard: "partnerOAuth", source: "openapi", file: "openapi.json" },
          { unit: "@demo/cloud-api", method: "GET", path: "/partner/devices", authGuard: "partnerOAuth", source: "openapi", file: "apps/cloud-api/openapi.json" },
          { unit: "@demo/cloud-api", method: "POST", path: "/saveMeasurements", authGuard: null, source: "ast", file: "apps/cloud-api/app.ts", line: 221 },
          { unit: "@demo/cloud-api", method: "GET", path: "/.well-known/oauth", authGuard: "public", source: "openapi", file: "apps/cloud-api/app.ts", line: 12 },
        ],
        envBindings: [
          { name: "UNSUBSCRIBE_HMAC_SECRET", sources: ["code_read"], units: ["@demo/platform", "@demo/cloud-api"], isSecret: true, sampleFile: "apps/cloud-api/app.ts" },
          { name: "GITHUB_TOKEN", sources: ["code_read"], units: ["@demo/platform"], isSecret: true, sampleFile: "scripts/ci.ts" },
          { name: "SHIPPO_API_KEY", sources: ["code_read", "env_example", "iac_secret"], units: ["@demo/cloud-api"], isSecret: true, sampleFile: "apps/cloud-api/app.ts" },
        ],
        foreignKeys: [],
      },
    };

    const lifecycles = [
      {
        entity: "devices",
        field: "status",
        writers: [
          { file: "a.ts", line: 1, fn: "setA", mode: "write" as const },
          { file: "b.ts", line: 2, fn: "setB", mode: "write" as const },
        ],
        multiWriterRisk: true,
      },
    ];

    const drilldown = {
      files: [
        { p: "apps/cloud-api/app.ts", u: "cloud-api", l: "transport", ln: 100, d: "", e: 0, c: [], t: false, b: false },
        { p: "apps/cloud-api/dao/device.ts", u: "cloud-api", l: "persistence", ln: 80, d: "", e: 0, c: [], t: false, b: false },
      ],
    };

    const m = buildSurfacesModel(spec, lifecycles, drilldown);
    expect(m.totals.rawEndpoints).toBe(4);
    expect(m.totals.endpoints).toBe(3);
    expect(m.totals.noGuardEndpoints).toBe(1);
    expect(m.totals.publicEndpoints).toBe(1);
    expect(m.endpoints.find((e) => e.path === "/partner/devices")?.unit).toBe("@demo/cloud-api");
    expect(m.endpoints.find((e) => e.path === "/saveMeasurements")?.prefix).toBe("(root)");

    const dev = m.entities.find((e) => e.entity === "device");
    expect(dev?.hubEntity).toBe("devices");
    expect(dev?.hubFieldCount).toBe(1);
    expect(dev?.multiWriterFields.length).toBe(1);
    expect(dev?.isTail).toBe(false);
    expect(m.entities.find((e) => e.entity === "samples")?.noContract).toBe(true);
    expect(m.entities.find((e) => e.entity === "tinyNote")?.isTail).toBe(true);

    const hmac = m.envVars.find((v) => v.name === "UNSUBSCRIBE_HMAC_SECRET");
    expect(hmac?.services).toEqual(["cloud-api"]);
    expect(hmac?.isDrift).toBe(true);
    const gh = m.envVars.find((v) => v.name === "GITHUB_TOKEN");
    expect(gh?.isBuiltin).toBe(true);
    expect(gh?.isDrift).toBe(false);
    expect(m.totals.secretsDrift).toBe(1);
    expect(m.totals.secretsInIac).toBe(1);
  });
});
