import type { TaskDefinition, OrchestratorProfile } from "@ai-workbench/shared";

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

const BUILT_IN_PROFILES: OrchestratorProfile[] = [
  {
    id: "conservative",
    name: "保守模式",
    description: "顺序执行，高质量阈值，最少重试。适合对质量要求极高的场景。",
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    config: {
      mode: "sequential",
      maxFixIterations: 1,
      qualityThreshold: 0.8,
      timeoutMinutes: 45,
      backgroundReview: false,
      errorWatchEnabled: true,
      agents: {
        planner:   { maxTurns: 15, enabled: true },
        developer: { maxTurns: 30, enabled: true },
        tester:    { maxTurns: 20, enabled: true },
        reviewer:  { maxTurns: 15, enabled: true },
      },
    },
  },
  {
    id: "balanced",
    name: "均衡模式",
    description: "修复循环模式，平衡质量与效率。适合大多数日常任务。",
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    config: {
      mode: "fixloop",
      maxFixIterations: 3,
      qualityThreshold: 0.6,
      timeoutMinutes: 30,
      backgroundReview: false,
      errorWatchEnabled: true,
      agents: {
        planner:   { maxTurns: 15, enabled: true },
        developer: { maxTurns: 40, enabled: true },
        tester:    { maxTurns: 25, enabled: true },
        reviewer:  { maxTurns: 20, enabled: true },
      },
    },
  },
  {
    id: "aggressive",
    name: "激进模式",
    description: "并行执行，低质量阈值，多次重试。适合快速迭代场景。",
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    config: {
      mode: "parallel",
      maxFixIterations: 5,
      qualityThreshold: 0.4,
      timeoutMinutes: 20,
      backgroundReview: true,
      errorWatchEnabled: true,
      agents: {
        planner:   { maxTurns: 20, enabled: true },
        developer: { maxTurns: 60, enabled: true },
        tester:    { maxTurns: 35, enabled: true },
        reviewer:  { maxTurns: 30, enabled: true },
      },
    },
  },
];

export class AdaptiveConfig {
  private baseConfig: Record<string, unknown>;

  constructor(baseConfig: Record<string, unknown>) {
    this.baseConfig = baseConfig;
  }

  updateBase(updates: Record<string, unknown>): void {
    this.baseConfig = { ...this.baseConfig, ...updates };
  }

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

  recommend(
    task: TaskDefinition,
    history: TaskHistoryEntry[],
    profile?: OrchestratorProfile,
  ): AdaptiveRecommendation {
    // If a profile is provided and it's not adaptive, use its config directly
    if (profile && profile.config.mode !== "adaptive") {
      return {
        crewMode: profile.config.mode,
        maxFixIterations: profile.config.maxFixIterations,
        qualityThreshold: profile.config.qualityThreshold,
        timeoutMinutes: profile.config.timeoutMinutes,
        agentMaxTurns: Object.fromEntries(
          Object.entries(profile.config.agents)
            .filter(([, v]) => v.enabled)
            .map(([k, v]) => [k, v.maxTurns]),
        ),
      };
    }

    const complexity = this.estimateComplexity(task);
    const profileConfig = profile?.config;
    const baseThreshold = profileConfig?.qualityThreshold ?? (this.baseConfig.qualityThreshold as number) ?? 0.6;
    const baseMaxFix = profileConfig?.maxFixIterations ?? (this.baseConfig.maxFixIterations as number) ?? 3;
    const baseTimeout = profileConfig?.timeoutMinutes ?? (this.baseConfig.defaultTimeout as number) ?? 30;

    const completed = history.filter((h) => h.result === "completed");
    const successRate = history.length > 0 ? completed.length / history.length : 0.5;

    let qualityThreshold = baseThreshold;
    let maxFixIterations = baseMaxFix;
    let timeoutMinutes = baseTimeout;

    if (successRate > 0.9) {
      qualityThreshold = Math.max(0.4, baseThreshold - 0.05);
    } else if (successRate < 0.5) {
      maxFixIterations = Math.min(5, baseMaxFix + 2);
      qualityThreshold = Math.min(0.8, baseThreshold + 0.05);
    }

    const timeouts = history.filter(
      (h) => h.result === "failed" && h.durationMs >= timeoutMinutes * 60000,
    );
    if (timeouts.length > 2) {
      timeoutMinutes = Math.round(timeoutMinutes * 1.5);
    }

    let crewMode: CrewMode;
    switch (complexity) {
      case "low": crewMode = "sequential"; break;
      case "high": crewMode = "parallel"; break;
      default: crewMode = "fixloop";
    }

    const turnMultiplier = complexity === "low" ? 0.5 : complexity === "high" ? 1.5 : 1.0;

    const baseAgentTurns = profileConfig?.agents
      ? Object.fromEntries(
          Object.entries(profileConfig.agents)
            .filter(([, v]) => v.enabled)
            .map(([k, v]) => [k, v.maxTurns]),
        )
      : {
          planner: (this.baseConfig.plannerMaxTurns as number) || 15,
          developer: (this.baseConfig.developerMaxTurns as number) || 40,
          tester: (this.baseConfig.testerMaxTurns as number) || 25,
          reviewer: (this.baseConfig.reviewerMaxTurns as number) || 20,
        };

    const agentMaxTurns = Object.fromEntries(
      Object.entries(baseAgentTurns).map(([k, v]) => [k, Math.round(v * turnMultiplier)]),
    );

    return { crewMode, maxFixIterations, qualityThreshold, timeoutMinutes, agentMaxTurns };
  }

  getBuiltInProfiles(): OrchestratorProfile[] {
    return BUILT_IN_PROFILES.map((p) => ({ ...p }));
  }
}
