/**
 * Goal Evaluator — 增强目标评估器
 *
 * 从 omx-executor.ts 提取并增强。使用轻量模型做结构化评估：
 *   - 里程碑进度清单
 *   - 阻塞点识别
 *   - 建议下一步策略
 *   - 证据列表
 */

import { CCClient } from "../../cc-integration/cc-client.js";
import type { ExecutionRun } from "@ai-workbench/shared";

// ─── 类型 ────────────────────────────────────────────────────────────────

export interface Milestone {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "achieved" | "blocked";
  evidence?: string;
  blocker?: string;
}

export interface GoalEvaluationResult {
  /** 目标是否已完成 */
  achieved: boolean;
  /** 总体进度 0-1 */
  progress: number;
  /** 评估理由 */
  reason: string;
  /** 证据列表 */
  evidence: string[];
  /** 里程碑进度 */
  milestones: Milestone[];
  /** 已完成的目标 */
  completedGoals: string[];
  /** 剩余目标 */
  remainingGoals: string[];
  /** 建议的下一步策略 */
  suggestedStrategy: StrategyType;
  /** 策略建议的理由 */
  strategyReason: string;
}

export type StrategyType = "decompose" | "escalate" | "pivot" | "human_input" | "continue";

// ─── 评估器 ──────────────────────────────────────────────────────────────

export class GoalEvaluator {
  private ccClient: CCClient;

  constructor(ccClient: CCClient) {
    this.ccClient = ccClient;
  }

  /**
   * 评估目标完成度。
   */
  async evaluate(run: ExecutionRun, workingDir: string): Promise<GoalEvaluationResult> {
    const prompt = this.buildEvaluationPrompt(run, workingDir);

    try {
      const stream = this.ccClient.executeTaskStream(prompt, {
        workingDir,
        timeoutMinutes: 2,
        maxTurns: 1,
        systemPrompt: EVALUATOR_SYSTEM_PROMPT,
        disallowedTools: [
          "AskUserQuestion",
          "Bash",
          "Read",
          "Write",
          "Edit",
          "Glob",
          "Grep",
          "WebSearch",
          "WebFetch",
          "Agent",
        ],
      });

      let responseText = "";
      for await (const msg of stream) {
        if (msg.type === "assistant") {
          const content = msg as unknown as Record<string, unknown>;
          if (typeof content.content === "string") responseText += content.content;
          else if (content.message && typeof (content.message as Record<string, unknown>).content === "object") {
            const blocks = (content.message as Record<string, unknown>).content as Array<Record<string, unknown>>;
            for (const block of blocks) {
              if (block.type === "text" && typeof block.text === "string") responseText += block.text;
            }
          }
        }
        if (msg.type === "result" && typeof msg.result === "string") {
          if (!responseText && msg.result) responseText = msg.result;
        }
      }

      return this.parseResult(responseText, run);
    } catch (err) {
      // 评估失败时降级
      return {
        achieved: false,
        progress: run.goalEvaluationCycles ? 0.3 : 0.1,
        reason: `评估失败: ${err instanceof Error ? err.message : String(err)}`,
        evidence: [],
        milestones: [],
        completedGoals: [],
        remainingGoals: run.goals,
        suggestedStrategy: "continue",
        strategyReason: "评估失败，降级为继续执行",
      };
    }
  }

  private buildEvaluationPrompt(run: ExecutionRun, _workingDir: string): string {
    return `评估以下运行目标的完成度。

## 运行信息
- Run ID: ${run.id}
- 状态: ${run.status}
- 已完成任务数: ${run.totalTasksCompleted}
- 已用预算: $${run.totalCostUsd.toFixed(2)}
- 评估循环次数: ${run.goalEvaluationCycles ?? 0}
- 上次评估理由: ${run.goalLastEvalReason || "无"}

## 目标列表
${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}

## 终止条件
${run.terminationConditions.map((c, i) => `${i + 1}. ${c}`).join("\n")}

## 之前收集的证据
${(run.goalEvidence ?? []).join("\n") || "无"}

## 评估要求

1. 分析每个目标的完成情况
2. 为每个目标创建里程碑（细粒度进度追踪）
3. 识别阻塞点
4. 建议下一步策略

## 输出 JSON 格式

{
  "achieved": true/false,
  "progress": 0.0-1.0,
  "reason": "总体评估理由",
  "evidence": ["证据1", "证据2"],
  "milestones": [
    { "id": "m1", "description": "里程碑描述", "status": "achieved/blocked/...", "evidence": "...", "blocker": "..." }
  ],
  "completedGoals": ["已完成的目标文本"],
  "remainingGoals": ["未完成的目标文本"],
  "suggestedStrategy": "decompose|escalate|pivot|human_input|continue",
  "strategyReason": "策略理由"
}`;
  }

  private parseResult(text: string, run: ExecutionRun): GoalEvaluationResult {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      return this.fallbackResult(run);
    }

    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const strategyValues: StrategyType[] = ["decompose", "escalate", "pivot", "human_input", "continue"];
      const statusValues = ["pending", "in_progress", "achieved", "blocked"];

      const milestones: Milestone[] = Array.isArray(parsed.milestones)
        ? (parsed.milestones as Record<string, unknown>[]).map((m, i) => ({
            id: (m.id as string) ?? `m${i + 1}`,
            description: (m.description as string) ?? "",
            status: statusValues.includes(m.status as string) ? (m.status as Milestone["status"]) : "pending",
            evidence: typeof m.evidence === "string" ? m.evidence : undefined,
            blocker: typeof m.blocker === "string" ? m.blocker : undefined,
          }))
        : [];

      return {
        achieved: !!parsed.achieved,
        progress: typeof parsed.progress === "number" ? Math.max(0, Math.min(1, parsed.progress)) : 0.5,
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
        evidence: Array.isArray(parsed.evidence) ? (parsed.evidence as string[]) : [],
        milestones,
        completedGoals: Array.isArray(parsed.completedGoals) ? (parsed.completedGoals as string[]) : [],
        remainingGoals: Array.isArray(parsed.remainingGoals) ? (parsed.remainingGoals as string[]) : run.goals,
        suggestedStrategy: strategyValues.includes(parsed.suggestedStrategy) ? parsed.suggestedStrategy : "continue",
        strategyReason: typeof parsed.strategyReason === "string" ? parsed.strategyReason : "",
      };
    } catch {
      return this.fallbackResult(run);
    }
  }

  private fallbackResult(run: ExecutionRun): GoalEvaluationResult {
    return {
      achieved: false,
      progress: 0.3,
      reason: "评估解析失败，使用降级结果",
      evidence: [],
      milestones: run.goals.map((g, i) => ({ id: `m${i + 1}`, description: g, status: "in_progress" as const })),
      completedGoals: [],
      remainingGoals: run.goals,
      suggestedStrategy: "continue",
      strategyReason: "评估降级",
    };
  }
}

const EVALUATOR_SYSTEM_PROMPT = `你是一个目标评估专家。评估项目目标的完成度。

关键原则：
1. 基于实际证据评估，不要猜测
2. 里程碑要具体、可验证
3. 策略建议要可操作
4. 只输出 JSON，不输出其他文字`;
