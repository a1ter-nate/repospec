import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { defineReport, renderReportHtml } from "@repospec/report";
import type { RepoSpecV4 } from "@repospec/plugin";

class RenderCmd implements fc.Command<{ rendered: number }, { render: (d: string) => void }> {
  constructor(readonly digest: string) {}
  check(): boolean { return true; }
  run(model: { rendered: number }, real: { render: (d: string) => void }): void {
    model.rendered += 1;
    real.render(this.digest);
  }
}

describe("@repospec/report render contract (R3 MBT)", () => {
  test("renderReportHtml passes digest cleanly into custom renderer", () => {
    fc.assert(
      fc.property(
        fc.commands([fc.stringMatching(/^[a-f0-9]{6,12}$/).map((d) => new RenderCmd(d))], { maxCommands: 4 }),
        (cmds) => {
          fc.modelRun(
            () => ({
              model: { rendered: 0 },
              real: {
                render: (d) => {
                  const html = renderReportHtml(
                    { spec: {} as RepoSpecV4, digest: d, inline: false },
                    defineReport({ renderHtml: (ctx) => `<div data-digest="${ctx.digest}"></div>` }),
                  );
                  expect(html).toContain(d);
                },
              },
            }),
            cmds,
          );
        },
      ),
      { numRuns: 15 },
    );
  });
});
