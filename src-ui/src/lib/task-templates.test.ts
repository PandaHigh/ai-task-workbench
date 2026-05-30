import { describe, it, expect } from "vitest";
import { BUILT_IN_TEMPLATES } from "./task-templates";

describe("task-templates", () => {
  it("should have 5 built-in templates", () => {
    expect(BUILT_IN_TEMPLATES).toHaveLength(5);
  });

  it("should have unique ids", () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  BUILT_IN_TEMPLATES.forEach((t) => {
    describe(`template: ${t.label}`, () => {
      it("should have required fields", () => {
        expect(t.id).toBeTruthy();
        expect(t.label).toBeTruthy();
        expect(t.icon).toBeTruthy();
        expect(t.content).toBeTruthy();
        expect(t.goals.length).toBeGreaterThan(0);
        expect(t.terminationConditions.length).toBeGreaterThan(0);
      });

      it("should have non-empty goals", () => {
        t.goals.forEach((g) => expect(g.trim()).toBeTruthy());
      });

      it("should have non-empty termination conditions", () => {
        t.terminationConditions.forEach((c) => expect(c.trim()).toBeTruthy());
      });
    });
  });
});
