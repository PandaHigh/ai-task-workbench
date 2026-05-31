import { describe, it, expect } from "vitest";
import {
  BUILT_IN_ROLES,
  PLANNER_ROLE,
  DEVELOPER_ROLE,
  TESTER_ROLE,
  REVIEWER_ROLE,
  DEFAULT_CREW_CONFIG,
  type CrewMode,
} from "../../src-engine/src/engine/agents/agent-role.js";

describe("AgentRole", () => {
  it("should define 6 built-in roles", () => {
    expect(Object.keys(BUILT_IN_ROLES)).toHaveLength(6);
    expect(BUILT_IN_ROLES).toHaveProperty("planner");
    expect(BUILT_IN_ROLES).toHaveProperty("developer");
    expect(BUILT_IN_ROLES).toHaveProperty("tester");
    expect(BUILT_IN_ROLES).toHaveProperty("reviewer");
    expect(BUILT_IN_ROLES).toHaveProperty("architect");
    expect(BUILT_IN_ROLES).toHaveProperty("integrator");
  });

  it("each role should have required fields", () => {
    for (const role of Object.values(BUILT_IN_ROLES)) {
      expect(role.id).toBeTruthy();
      expect(role.name).toBeTruthy();
      expect(role.description).toBeTruthy();
      expect(role.systemPrompt).toBeTruthy();
      expect(Array.isArray(role.tools)).toBe(true);
      expect(role.tools.length).toBeGreaterThan(0);
      expect(role.maxTurns).toBeGreaterThan(0);
    }
  });

  it("planner should have read-only tools", () => {
    expect(PLANNER_ROLE.tools).toEqual(["Read", "Glob", "Grep", "Bash"]);
    expect(PLANNER_ROLE.tools).not.toContain("Write");
    expect(PLANNER_ROLE.tools).not.toContain("Edit");
  });

  it("developer should have write tools", () => {
    expect(DEVELOPER_ROLE.tools).toContain("Write");
    expect(DEVELOPER_ROLE.tools).toContain("Edit");
  });

  it("tester should have write tools for test files", () => {
    expect(TESTER_ROLE.tools).toContain("Write");
    expect(TESTER_ROLE.tools).toContain("Edit");
  });

  it("reviewer should have read-only tools", () => {
    expect(REVIEWER_ROLE.tools).not.toContain("Write");
    expect(REVIEWER_ROLE.tools).not.toContain("Edit");
  });

  it("roles should have different maxTurns", () => {
    expect(PLANNER_ROLE.maxTurns).toBeLessThan(DEVELOPER_ROLE.maxTurns);
  });
});

describe("CrewConfig", () => {
  it("DEFAULT_CREW_CONFIG should use fixloop mode", () => {
    expect(DEFAULT_CREW_CONFIG.mode).toBe("fixloop");
  });

  it("DEFAULT_CREW_CONFIG should include all 4 agents", () => {
    expect(DEFAULT_CREW_CONFIG.agents).toEqual(["planner", "developer", "tester", "reviewer"]);
  });

  it("DEFAULT_CREW_CONFIG should have maxFixIterations of 3", () => {
    expect(DEFAULT_CREW_CONFIG.maxFixIterations).toBe(3);
  });

  it("CrewMode type should accept all valid values", () => {
    const modes: CrewMode[] = ["sequential", "fixloop", "parallel", "adaptive"];
    expect(modes).toHaveLength(4);
    for (const mode of modes) {
      expect(["sequential", "fixloop", "parallel", "adaptive"]).toContain(mode);
    }
  });
});
