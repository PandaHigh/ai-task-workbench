import type { TaskDefinition } from "@ai-workbench/shared";

export type TaskComplexity = "low" | "medium" | "high";
export type CrewMode = "sequential" | "fixloop" | "parallel" | "adaptive";

export interface AdaptiveRecommendation {
  crewMode: CrewMode;
  maxFixIterations: number;
  agentMaxTurns: Record<string, number>;
  qualityThreshold: number;
  timeoutMinutes: number;
}

export interface TaskHistoryEntry {
  content: string;
  type: string;
  complexity: TaskComplexity;
  config: Record<string, unknown>;
  result: "completed" | "failed" | "reverted";
  score: number;
  durationMs: number;
}

export class AdaptiveConfig {
  private baseConfig: Record<string, unknown>;

  constructor(baseConfig: Record<string, unknown>) {
    this.baseConfig = baseConfig;
  }

  /** Update base config (e.g. after user changes settings). */
  updateBase(updates: Record<string, unknown>): void {
    this.baseConfig = { ...this.baseConfig, ...updates };
  }

  /** Estimate task complexity from content heuristics. */
  estimateComplexity(task: TaskDefinition): TaskComplexity {
    const content = task.content || "";
    const wordCount = content.split(/\s+/).length;

    const hasMultipleFiles =
      /\b(modify|update|change|refactor)\b.*\b(files?|modules?)\b/i.test(content);
    const hasSpecificTargets =
      content.includes("->") || content.includes(".") || content.includes("/");
    const hasEdgeCases =
      /\b(edge\s?case|error\s?handling|boundary|security)\b/i.test(content);

    let score = 0;
    if (wordCount > 200) score += 3;
    else if (wordCount > 100) score += 2;
    else if (wordCount > 50) score += 1;

    if (hasMultipleFiles) score += 2;
    if (hasSpecificTargets) score += 1;
    if (hasEdgeCases) score += 2;

    if (score >= 5) return "high";
    if (score >= 2) return "medium";
    return "low";
  }

  /** Produce an adaptive recommendation based on task + historical performance. */
  recommend(
    task: TaskDefinition,
    history: TaskHistoryEntry[],
  ): AdaptiveRecommendation {
    const complexity = this.estimateComplexity(task);
    const baseThreshold =
      (this.baseConfig.qualityThreshold as number) || 0.6;
    const baseMaxFix =
      (this.baseConfig.maxFixIterations as number) || 3;
    const baseTimeout =
      (this.baseConfig.defaultTimeout as number) || 30;

    // ── Historical success rate ──────────────────────────────────────────
    const completed = history.filter((h) => h.result === "completed");
    const successRate =
      history.length > 0 ? completed.length / history.length : 0.5;

    let qualityThreshold = baseThreshold;
    let maxFixIterations = baseMaxFix;
    let timeoutMinutes = baseTimeout;

    // High success → be slightly less strict (save iterations)
    if (successRate > 0.9) {
      qualityThreshold = Math.max(0.4, baseThreshold - 0.05);
    } else if (successRate < 0.5) {
      // Low success → give more fix attempts and raise bar
      maxFixIterations = Math.min(5, baseMaxFix + 2);
      qualityThreshold = Math.min(0.8, baseThreshold + 0.05);
    }

    // If we see repeated timeouts, extend the limit
    const timeouts = history.filter(
      (h) => h.result === "failed" && h.durationMs >= timeoutMinutes * 60000,
    );
    if (timeouts.length > 2) {
      timeoutMinutes = Math.round(timeoutMinutes * 1.5);
    }

    // ── Crew mode by complexity ──────────────────────────────────────────
    let crewMode: CrewMode;
    switch (complexity) {
      case "low":
        crewMode = "sequential";
        break;
      case "high":
        crewMode = "parallel";
        break;
      default:
        crewMode = "fixloop";
    }

    // ── Per-agent turns ──────────────────────────────────────────────────
    const turnMultiplier =
      complexity === "low" ? 0.5 : complexity === "high" ? 1.5 : 1.0;

    return {
      crewMode,
      maxFixIterations,
      qualityThreshold,
      timeoutMinutes,
      agentMaxTurns: {
        planner: Math.round(
          ((this.baseConfig.plannerMaxTurns as number) || 15) * turnMultiplier,
        ),
        developer: Math.round(
          ((this.baseConfig.developerMaxTurns as number) || 40) *
            turnMultiplier,
        ),
        tester: Math.round(
          ((this.baseConfig.testerMaxTurns as number) || 25) * turnMultiplier,
        ),
        reviewer: Math.round(
          ((this.baseConfig.reviewerMaxTurns as number) || 20) * turnMultiplier,
        ),
      },
    };
  }
}
