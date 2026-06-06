/**
 * Goal Strategy — 自适应策略选择
 *
 * 根据目标评估反馈选择下一步策略：
 *   - decompose: 拆分更细的子任务
 *   - escalate: 升级到更强模型
 *   - pivot: 换一种方法
 *   - human_input: 请求人工指导
 *   - continue: 继续当前策略
 */

import type { GoalEvaluationResult, StrategyType } from "./goal-evaluator.js";

export interface StrategyDecision {
  strategy: StrategyType;
  reason: string;
  /** 要生成的任务数量（decompose 时有意义） */
  taskCount?: number;
  /** 是否需要暂停等待人工输入 */
  needsHumanInput: boolean;
  /** 优先级调整 */
  priorityBoost?: number;
}

/**
 * 根据评估结果选择自适应策略
 */
export function selectStrategy(evaluation: GoalEvaluationResult): StrategyDecision {
  const { progress, suggestedStrategy, strategyReason, milestones } = evaluation;

  // 如果 AI 已经建议了策略，优先遵循
  if (suggestedStrategy === "human_input") {
    return {
      strategy: "human_input",
      reason: strategyReason || "AI 建议请求人工指导",
      needsHumanInput: true,
    };
  }

  // 检查是否有阻塞的里程碑
  const blockedMilestones = milestones.filter((m) => m.status === "blocked");
  if (blockedMilestones.length > 0) {
    return {
      strategy: "human_input",
      reason: `${blockedMilestones.length} 个里程碑被阻塞: ${blockedMilestones.map((m) => m.blocker ?? m.description).join(", ")}`,
      needsHumanInput: true,
    };
  }

  // 进度过低且未完成任何目标 → 拆分
  if (progress < 0.2 && evaluation.completedGoals.length === 0) {
    return {
      strategy: "decompose",
      reason: "进度过低，建议将目标拆分为更小的子任务",
      taskCount: 3,
      needsHumanInput: false,
    };
  }

  // 进度中等 → 继续当前策略
  if (progress < 0.7) {
    return {
      strategy: suggestedStrategy === "pivot" ? "pivot" : "continue",
      reason: strategyReason || "目标仍在推进中，继续当前策略",
      taskCount: suggestedStrategy === "decompose" ? 2 : undefined,
      needsHumanInput: false,
    };
  }

  // 进度较高 → 继续完成剩余
  return {
    strategy: "continue",
    reason: `进度 ${Math.round(progress * 100)}%，继续完成剩余目标`,
    taskCount: 1,
    needsHumanInput: false,
    priorityBoost: 1,
  };
}
