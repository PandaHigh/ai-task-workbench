/**
 * Task Router — 任务路由器
 *
 * 简化为两档路由：
 *   1. 简单任务 → direct（单次 CC 调用）
 *   2. 其余任务 → pipeline（OMX 5阶段流水线）
 *
 * 路由流程：
 *   1. 快速关键词预匹配 → 命中复杂关键词直接走 pipeline
 *   2. 无命中 → 调用 CC 做完整复杂度评估
 *   3. 根据评估结果选择 direct / pipeline
 */

import type { TaskDefinition } from "@ai-workbench/shared";
import { CCClient } from "../../cc-integration/cc-client.js";
import { buildRouterPrompt, PIPELINE_KEYWORDS } from "./router-prompts.js";
import type {
  ComplexityAssessment,
  ComplexityLevel,
  ComplexityDimensions,
  ExecutionStrategy,
  RoutingContext,
  RouterDecision,
} from "./complexity-types.js";

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

export class TaskRouter {
  private ccClient: CCClient;
  private notify: NotifyFn | null = null;

  constructor(ccClient?: CCClient) {
    this.ccClient = ccClient ?? new CCClient();
  }

  /** 设置通知回调（可选，用于向前端广播路由决策） */
  setNotifyFn(notify: NotifyFn): void {
    this.notify = notify;
  }

  /**
   * 分析任务并返回路由决策。
   */
  async analyze(task: TaskDefinition, context: RoutingContext): Promise<ComplexityAssessment> {
    // Step 1: 快速关键词预匹配
    if (this.quickMatchPipeline(task.content)) {
      const assessment = this.buildPipelineAssessment(task.content);
      this.emitDecision(task, assessment);
      return assessment;
    }

    // Step 2: CC 完整评估
    const assessment = await this.fullAnalysis(task, context);
    this.emitDecision(task, assessment);
    return assessment;
  }

  /**
   * 快速关键词预匹配：命中复杂关键词直接走 pipeline。
   */
  private quickMatchPipeline(taskContent: string): boolean {
    const lower = taskContent.toLowerCase();
    return PIPELINE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
  }

  /**
   * 调用 CC 做完整复杂度评估。
   */
  private async fullAnalysis(task: TaskDefinition, context: RoutingContext): Promise<ComplexityAssessment> {
    const prompt = buildRouterPrompt(task.content, {
      workingDir: context.workingDir,
      completedTaskCount: context.completedTaskCount,
      costUsedUsd: context.costUsedUsd,
      costBudgetUsd: context.costBudgetUsd,
      hasGoals: context.hasGoals,
    });

    try {
      const stream = this.ccClient.executeTaskStream(prompt, {
        workingDir: context.workingDir,
        timeoutMinutes: 1,
        maxTurns: 1,
        systemPrompt: "你是一个任务复杂度评估器。只输出 JSON，不输出其他文字。",
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
          if (typeof content.content === "string") {
            responseText += content.content;
          } else if (content.message && typeof (content.message as Record<string, unknown>).content === "object") {
            const blocks = (content.message as Record<string, unknown>).content as Array<Record<string, unknown>>;
            for (const block of blocks) {
              if (block.type === "text" && typeof block.text === "string") {
                responseText += block.text;
              }
            }
          }
        }
        if (msg.type === "result" && typeof msg.result === "string") {
          if (!responseText && msg.result) responseText = msg.result;
        }
      }

      return this.parseAssessment(responseText);
    } catch (err) {
      // 评估失败时降级为 pipeline
      console.warn(
        "[task-router] Complexity analysis failed, falling back to pipeline:",
        err instanceof Error ? err.message : String(err),
      );
      return {
        level: "moderate",
        strategy: { type: "pipeline" },
        confidence: 0.3,
        reason: "复杂度评估失败，降级为 pipeline",
        dimensions: { scope: 0.5, uncertainty: 0.5, risk: 0.5, parallelism: 0.3, verificationNeed: 0.3 },
        estimatedAgents: 5,
        estimatedCostUsd: 1.0,
      };
    }
  }

  /**
   * 解析 CC 返回的 JSON 为 ComplexityAssessment。
   */
  private parseAssessment(text: string): ComplexityAssessment {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      return this.defaultAssessment();
    }

    try {
      const parsed = JSON.parse(jsonMatch[1]);

      const level = this.validateEnum<ComplexityLevel>(
        parsed.level,
        ["simple", "moderate", "complex", "massive"],
        "moderate",
      );
      const strategy = this.parseStrategy(parsed.strategy);
      const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
      const dimensions = this.parseDimensions(parsed.dimensions);

      return {
        level,
        strategy,
        confidence,
        reason: typeof parsed.reason === "string" ? parsed.reason : "AI 评估完成",
        dimensions,
        estimatedAgents: typeof parsed.estimatedAgents === "number" ? Math.max(1, parsed.estimatedAgents) : 5,
        estimatedCostUsd: typeof parsed.estimatedCostUsd === "number" ? Math.max(0, parsed.estimatedCostUsd) : 1.0,
      };
    } catch {
      return this.defaultAssessment();
    }
  }

  private parseStrategy(raw: unknown): ExecutionStrategy {
    if (!raw || typeof raw !== "object") {
      return { type: "pipeline" };
    }
    const s = raw as Record<string, unknown>;
    if (s.type === "direct") return { type: "direct" };
    // 任何非 direct 的都走 pipeline
    return { type: "pipeline" };
  }

  private parseDimensions(raw: unknown): ComplexityDimensions {
    if (!raw || typeof raw !== "object") {
      return { scope: 0.5, uncertainty: 0.5, risk: 0.5, parallelism: 0.3, verificationNeed: 0.3 };
    }
    const d = raw as Record<string, number>;
    const clamp = (v: unknown) => (typeof v === "number" ? Math.max(0, Math.min(1, v)) : 0.5);
    return {
      scope: clamp(d.scope),
      uncertainty: clamp(d.uncertainty),
      risk: clamp(d.risk),
      parallelism: clamp(d.parallelism),
      verificationNeed: clamp(d.verificationNeed),
    };
  }

  private validateEnum<T extends string>(value: unknown, valid: T[], fallback: T): T {
    if (typeof value === "string" && (valid as string[]).includes(value)) return value as T;
    return fallback;
  }

  /** 关键词匹配命中时的评估结果 — 直接走 pipeline */
  private buildPipelineAssessment(_taskContent: string): ComplexityAssessment {
    return {
      level: "complex",
      strategy: { type: "pipeline" },
      confidence: 0.85,
      reason: `关键词匹配到复杂任务，走 OMX Pipeline`,
      dimensions: { scope: 0.7, uncertainty: 0.4, risk: 0.5, parallelism: 0.5, verificationNeed: 0.6 },
      estimatedAgents: 5,
      estimatedCostUsd: 2.0,
    };
  }

  /** 默认评估（解析失败时降级） */
  private defaultAssessment(task?: TaskDefinition): ComplexityAssessment {
    if (task) {
      const contentLength = task.content.length;
      const isLikelySimple = contentLength < 50 && !task.dependsOn?.length;

      if (isLikelySimple) {
        return {
          level: "simple",
          strategy: { type: "direct" },
          confidence: 0.4,
          reason: "任务描述简短，走直接执行",
          dimensions: { scope: 0.2, uncertainty: 0.3, risk: 0.2, parallelism: 0.1, verificationNeed: 0.2 },
          estimatedAgents: 1,
          estimatedCostUsd: 0.1,
        };
      }
    }

    return {
      level: "moderate",
      strategy: { type: "pipeline" },
      confidence: 0.4,
      reason: "评估降级为 pipeline",
      dimensions: { scope: 0.5, uncertainty: 0.5, risk: 0.5, parallelism: 0.3, verificationNeed: 0.3 },
      estimatedAgents: 5,
      estimatedCostUsd: 1.0,
    };
  }

  /** 广播路由决策通知 */
  private emitDecision(task: TaskDefinition, assessment: ComplexityAssessment): void {
    if (!this.notify) return;

    const decision: RouterDecision = {
      taskId: task.id,
      taskSummary: task.content.substring(0, 100),
      strategy: assessment.strategy,
      level: assessment.level,
      reason: assessment.reason,
      confidence: assessment.confidence,
      timestamp: Date.now(),
    };

    this.notify("router.decision", { decision, assessment });
  }
}
