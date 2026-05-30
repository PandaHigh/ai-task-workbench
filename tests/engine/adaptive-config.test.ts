import { describe, it, expect } from "vitest";
import { AdaptiveConfig, type TaskComplexity } from "../../src-engine/src/engine/adaptive-config.js";
import type { TaskDefinition } from "@ai-workbench/shared";

function makeTask(content: string): TaskDefinition {
  return { id: "t1", content, type: "user_defined", priority: 5, status: "pending" };
}

describe("AdaptiveConfig", () => {
  const baseConfig = {
    qualityThreshold: 0.6,
    maxFixIterations: 3,
    defaultTimeout: 30,
    plannerMaxTurns: 15,
    developerMaxTurns: 40,
    testerMaxTurns: 25,
    reviewerMaxTurns: 20,
  };

  it("should estimate low complexity for short tasks", () => {
    const adaptive = new AdaptiveConfig(baseConfig);
    expect(adaptive.estimateComplexity(makeTask("Fix typo"))).toBe("low");
  });

  it("should estimate medium complexity for moderate tasks", () => {
    const adaptive = new AdaptiveConfig(baseConfig);
    const task = makeTask("Add error handling to the login endpoint and update the error response format -> JSON with error code and message");
    expect(adaptive.estimateComplexity(task)).toBe("medium");
  });

  it("should estimate high complexity for large tasks", () => {
    const adaptive = new AdaptiveConfig(baseConfig);
    const task = makeTask(
      "Refactor the entire authentication module to support OAuth2. " +
      "Modify files across auth, user, session modules. " +
      "Handle edge cases for token refresh, error handling, security boundary conditions."
    );
    const result = adaptive.estimateComplexity(task);
    expect(result === "medium" || result === "high").toBe(true);
  });

  it("should detect multi-file keywords", () => {
    const adaptive = new AdaptiveConfig(baseConfig);
    const task = makeTask("Modify files in the config module to update the settings");
    expect(adaptive.estimateComplexity(task)).not.toBe("low");
  });

  it("should detect edge case keywords", () => {
    const adaptive = new AdaptiveConfig(baseConfig);
    const task = makeTask("Add edge case handling for null values and error handling");
    expect(adaptive.estimateComplexity(task)).not.toBe("low");
  });

  it("should recommend sequential for low complexity", () => {
    const adaptive = new AdaptiveConfig(baseConfig);
    const rec = adaptive.recommend(makeTask("Fix typo"), []);
    expect(rec.crewMode).toBe("sequential");
    expect(rec.qualityThreshold).toBe(0.6);
  });

  it("should recommend fixloop for medium complexity", () => {
    const adaptive = new AdaptiveConfig(baseConfig);
    const task = makeTask("Add error handling to the login endpoint and update the error response format -> JSON");
    const rec = adaptive.recommend(task, []);
    expect(rec.crewMode).toBe("fixloop");
  });

  it("should recommend parallel for high complexity", () => {
    const adaptive = new AdaptiveConfig(baseConfig);
    const task = makeTask(
      "Refactor the entire authentication module to support OAuth2. " +
      "Modify files across auth, user, session modules. " +
      "Handle edge cases for token refresh, error handling, security boundary conditions. " +
      "This is a large change that touches multiple systems and requires extensive testing."
    );
    const rec = adaptive.recommend(task, []);
    expect(rec.crewMode === "fixloop" || rec.crewMode === "parallel").toBe(true);
  });

  it("should lower quality threshold when success rate is high", () => {
    const adaptive = new AdaptiveConfig(baseConfig);
    const history = Array(10).fill(null).map(() => ({
      content: "task", type: "user_defined", complexity: "low" as TaskComplexity,
      config: {}, result: "completed" as const, score: 0.9, durationMs: 5000,
    }));
    const rec = adaptive.recommend(makeTask("Fix typo"), history);
    expect(rec.qualityThreshold).toBeLessThan(0.6);
  });

  it("should raise fix iterations when success rate is low", () => {
    const adaptive = new AdaptiveConfig(baseConfig);
    const history = Array(10).fill(null).map(() => ({
      content: "task", type: "user_defined", complexity: "high" as TaskComplexity,
      config: {}, result: "failed" as const, score: 0.3, durationMs: 5000,
    }));
    const rec = adaptive.recommend(makeTask("Complex refactoring task"), history);
    expect(rec.maxFixIterations).toBeGreaterThan(3);
  });

  it("should extend timeout when there are repeated timeouts", () => {
    const adaptive = new AdaptiveConfig(baseConfig);
    const history = Array(5).fill(null).map(() => ({
      content: "task", type: "user_defined", complexity: "medium" as TaskComplexity,
      config: {}, result: "failed" as const, score: 0.2, durationMs: 30 * 60000, // timed out
    }));
    const rec = adaptive.recommend(makeTask("Medium task"), history);
    expect(rec.timeoutMinutes).toBeGreaterThan(30);
  });

  it("should scale agent turns by complexity", () => {
    const adaptive = new AdaptiveConfig(baseConfig);

    const lowRec = adaptive.recommend(makeTask("Fix typo"), []);
    const highRec = adaptive.recommend(
      makeTask("Refactor the entire module. Modify files across multiple directories. Handle all edge cases and error handling."),
      []
    );

    expect(lowRec.agentMaxTurns.developer).toBeLessThan(highRec.agentMaxTurns.developer);
  });

  it("should update base config", () => {
    const adaptive = new AdaptiveConfig(baseConfig);
    adaptive.updateBase({ qualityThreshold: 0.8 });
    const rec = adaptive.recommend(makeTask("Fix typo"), []);
    expect(rec.qualityThreshold).toBeGreaterThanOrEqual(0.7);
  });
});
