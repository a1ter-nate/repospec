import { describe, expect, test } from "bun:test";
import { defaultReport, defineReport, renderReportHtml } from "@repospec/report";
import type { RepoSpecV4 } from "@repospec/plugin";

describe("@repospec/report unit invariants (R2)", () => {
  test("defineReport returns customization and renderReportHtml supports full override", () => {
    expect(defaultReport).toEqual({});
    const custom = defineReport({ renderHtml: (ctx) => `<main>${ctx.digest}</main>` });
    const html = renderReportHtml({ spec: {} as RepoSpecV4, digest: "sha-demo", inline: true }, custom);
    expect(html).toBe("<main>sha-demo</main>");
  });
});
