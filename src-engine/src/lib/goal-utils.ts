import type { ExecutionRun } from "@ai-workbench/shared";

export function serializeGoalState(run: ExecutionRun): Record<string, unknown> {
  return {
    status: run.goalStatus ?? "unmet",
    tokensUsed: run.goalTokensUsed ?? 0,
    budgetTokens: run.goalBudgetTokens ?? 500_000,
    timeElapsedMs: run.goalTimeElapsedMs ?? 0,
    evaluationCycles: run.goalEvaluationCycles ?? 0,
    lastEvaluationReason: run.goalLastEvalReason ?? "",
    evidence: run.goalEvidence ?? [],
  };
}
