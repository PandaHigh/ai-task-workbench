import type { OrchestratorProfile } from "@ai-workbench/shared";

export type CrewMode = "sequential" | "fixloop" | "parallel" | "adaptive";

const BUILT_IN_PROFILES: OrchestratorProfile[] = [
  {
    id: "adaptive",
    name: "自适应模式",
    description: "根据任务复杂度和历史表现，自动选择最优执行策略。推荐大多数场景使用。",
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    config: {
      mode: "adaptive",
      maxFixIterations: 3,
      qualityThreshold: 0.6,
      timeoutMinutes: 30,
      agents: {
        planner:   { maxTurns: 15, enabled: true },
        developer: { maxTurns: 40, enabled: true },
        tester:    { maxTurns: 25, enabled: true },
        reviewer:  { maxTurns: 20, enabled: true },
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
      agents: {
        planner:   { maxTurns: 15, enabled: true },
        developer: { maxTurns: 40, enabled: true },
        tester:    { maxTurns: 25, enabled: true },
        reviewer:  { maxTurns: 20, enabled: true },
      },
    },
  },
];

export const DEFAULT_CREW_CONFIG = { mode: "adaptive" as CrewMode };

export function getBuiltInProfiles(): OrchestratorProfile[] {
  return BUILT_IN_PROFILES.map((p) => ({ ...p }));
}
