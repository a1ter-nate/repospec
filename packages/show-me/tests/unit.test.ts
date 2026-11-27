import { describe, expect, test } from "bun:test";
import { defaultShowMe, defineShowMe } from "@repospec/show-me";

describe("@repospec/show-me unit invariants (R2)", () => {
  test("exposes defaultShowMe pipeline primitives and defineShowMe helper", () => {
    expect(typeof defaultShowMe.triage).toBe("function");
    expect(typeof defaultShowMe.selectShots).toBe("function");
    expect(typeof defaultShowMe.formatComment).toBe("function");
    const custom = defineShowMe({});
    expect(custom).toEqual({});
  });
});
