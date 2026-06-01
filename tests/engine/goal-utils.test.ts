import { describe, it, expect } from "vitest";
import { serializeGoalState } from "../../src-engine/src/lib/goal-utils.js";
import type { ExecutionRun } from "@ai-workbench/shared";

function makeRun(overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id: "run-1",
    goal: "test goal",
    createdAt: Date.now(),
    status: "running",
    ...overrides,
  } as ExecutionRun;
}

// ─── serializeGoalState ───────────────────────────────────────────────────

describe("serializeGoalState", () => {
  it("returns defaults when run has no goal fields", () => {
    const run = makeRun();
    const state = serializeGoalState(run);

    expect(state).toEqual({
      status: "unmet",
      tokensUsed: 0,
      budgetTokens: Infinity,
      timeElapsedMs: 0,
      evaluationCycles: 0,
      lastEvaluationReason: "",
      evidence: [],
    });
  });

  it("maps all goal fields correctly", () => {
    const run = makeRun({
      goalStatus: "met",
      goalTokensUsed: 12345,
      goalBudgetTokens: 1_000_000,
      goalTimeElapsedMs: 60000,
      goalEvaluationCycles: 5,
      goalLastEvalReason: "All tasks completed",
      goalEvidence: ["file1.ts created", "test passed"],
    });

    const state = serializeGoalState(run);

    expect(state).toEqual({
      status: "met",
      tokensUsed: 12345,
      budgetTokens: 1_000_000,
      timeElapsedMs: 60000,
      evaluationCycles: 5,
      lastEvaluationReason: "All tasks completed",
      evidence: ["file1.ts created", "test passed"],
    });
  });

  it("handles partial fields", () => {
    const run = makeRun({
      goalStatus: "in_progress",
      goalEvaluationCycles: 3,
      goalEvidence: ["partial evidence"],
    });

    const state = serializeGoalState(run);

    expect(state.status).toBe("in_progress");
    expect(state.evaluationCycles).toBe(3);
    expect(state.evidence).toEqual(["partial evidence"]);
    // Defaults for unspecified fields
    expect(state.tokensUsed).toBe(0);
    expect(state.budgetTokens).toBe(Infinity);
    expect(state.timeElapsedMs).toBe(0);
    expect(state.lastEvaluationReason).toBe("");
  });
});
