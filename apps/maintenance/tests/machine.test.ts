import { describe, expect, it } from "vitest";
import { ALLOWED_TRANSITIONS, canTransition, JOB_STATES } from "../src/pipeline/machine.js";

describe("maintenance state machine", () => {
  it("includes terminal and retry states", () => {
    expect(JOB_STATES).toContain("NEEDS_MANUAL");
    expect(JOB_STATES).toContain("RETRYING");
    expect(JOB_STATES).toContain("PR_READY");
  });

  it("allows validation to retry or become PR_READY", () => {
    expect(canTransition("VALIDATING", "RETRYING")).toBe(true);
    expect(canTransition("VALIDATING", "PR_READY")).toBe(true);
    expect(canTransition("RETRYING", "UPDATING")).toBe(true);
  });

  it("does not allow delivered to leave", () => {
    expect(ALLOWED_TRANSITIONS.DELIVERED).toEqual([]);
  });
});
