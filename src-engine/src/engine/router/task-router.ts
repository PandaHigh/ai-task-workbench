/**
 * Task Router — 任务路由器
 *
 * 借鉴 Claude Code Ultracode 模式，根据任务复杂度动态选择执行策略。
 *
 * 路由流程：
 *   1. 快速关键词预匹配 → 命中内置模板则直接推荐
 *   2. 无命中 → 调用 CC 做完整复杂度评估
 *   3. 根据评估结果选择 direct / builtin:xxx / dynamic
 */

import type { TaskDefinition } from "@ai-workbench/shared";
import { CCClient } from "../../cc-integration/cc-client.js";
import { buildRouterPrompt, TEMPLATE_KEYWORDS } from "./router-prompts.js";
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
   *
   * @param task 待分析的任务
   * @param context 当前运行上下文（预算、已完成数等）
   * @returns 路由决策结果
   */
  async analyze(task: TaskDefinition, context: RoutingContext): Promise<ComplexityAssessment> {
    // Step 1: 快速关键词预匹配
    const quickMatch = this.quickMatch(task.content);
    if (quickMatch) {
      const assessment = this.buildAssessmentFromQuickMatch(task, quickMatch, context);
      this.emitDecision(task, assessment);
      return assessment;
    }

    // Step 2: CC 完整评估
    const assessment = await this.fullAnalysis(task, context);
    this.emitDecision(task, assessment);
    return assessment;
  }

  /**
   * 快速关键词预匹配。
   * 如果任务内容包含内置模板的关键词，直接推荐对应模板。
   * 返回 null 表示无命中，需要走完整评估。
   */
  private quickMatch(taskContent: string): string | null {
    const lower = taskContent.toLowerCase();
    let bestMatch: string | null = null;
    let bestPriority = 0;

    for (const [templateName, config] of Object.entries(TEMPLATE_KEYWORDS)) {
      const hit = config.keywords.some((kw) => lower.includes(kw.toLowerCase()));
      if (hit && config.priority > bestPriority) {
        bestMatch = templateName;
        bestPriority = config.priority;
      }
    }

    return bestMatch;
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
          "AskUserQuestion", "Bash", "Read", "Write", "Edit",
          "Glob", "Grep", "WebSearch", "WebFetch", "Agent",
        ],
      });

      let responseText = "";
      for await (const msg of stream) {
        if (msg.type === "assistant") {
          const content = (msg as unknown as Record<string, unknown>);
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
      // 评估失败时降级为默认策略（omx-pipeline）
      console.warn("[task-router] Complexity analysis failed, falling back to omx-pipeline:", err instanceof Error ? err.message : String(err));
      return {
        level: "moderate",
        strategy: { type: "builtin", templateName: "omx-pipeline" },
        confidence: 0.3,
        reason: "复杂度评估失败，降级为标准 pipeline",
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
    // 提取 JSON（可能被 markdown code block 包裹）
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      // 解析失败，降级
      return this.defaultAssessment();
    }

    try {
      const parsed = JSON.parse(jsonMatch[1]);

      const level = this.validateEnum<ComplexityLevel>(parsed.level, ["simple", "moderate", "complex", "massive"], "moderate");
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
      return { type: "builtin", templateName: "omx-pipeline" };
    }
    const s = raw as Record<string, unknown>;
    if (s.type === "direct") return { type: "direct" };
    if (s.type === "dynamic") return { type: "dynamic" };
    if (s.type === "builtin" && typeof s.templateName === "string") {
      return { type: "builtin", templateName: s.templateName };
    }
    return { type: "builtin", templateName: "omx-pipeline" };
  }

  private parseDimensions(raw: unknown): ComplexityDimensions {
    if (!raw || typeof raw !== "object") {
      return { scope: 0.5, uncertainty: 0.5, risk: 0.5, parallelism: 0.3, verificationNeed: 0.3 };
    }
    const d = raw as Record<string, number>;
    const clamp = (v: unknown) => typeof v === "number" ? Math.max(0, Math.min(1, v)) : 0.5;
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

  /** 快速匹配命中的评估结果 */
  private buildAssessmentFromQuickMatch(
    _task: TaskDefinition,
    templateName: string,
    _context: RoutingContext,
  ): ComplexityAssessment {
    // 根据模板名推断复杂度和维度
    const templateProfiles: Record<string, { level: ComplexityLevel; dimensions: ComplexityDimensions; agents: number; cost: number }> = {
      "security-audit": { level: "complex", dimensions: { scope: 0.8, uncertainty: 0.4, risk: 0.9, parallelism: 0.8, verificationNeed: 0.9 }, agents: 8, cost: 3.0 },
      "code-review":    { level: "complex", dimensions: { scope: 0.6, uncertainty: 0.3, risk: 0.6, parallelism: 0.7, verificationNeed: 0.7 }, agents: 5, cost: 2.0 },
      "bug-sweep":      { level: "complex", dimensions: { scope: 0.7, uncertainty: 0.6, risk: 0.5, parallelism: 0.7, verificationNeed: 0.8 }, agents: 6, cost: 2.5 },
      "migration":      { level: "massive", dimensions: { scope: 0.9, uncertainty: 0.5, risk: 0.7, parallelism: 0.9, verificationNeed: 0.7 }, agents: 15, cost: 10.0 },
      "dead-code":      { level: "complex", dimensions: { scope: 0.7, uncertainty: 0.3, risk: 0.3, parallelism: 0.8, verificationNeed: 0.6 }, agents: 5, cost: 2.0 },
    };

    const profile = templateProfiles[templateName] ?? {
      level: "moderate" as ComplexityLevel,
      dimensions: { scope: 0.5, uncertainty: 0.4, risk: 0.4, parallelism: 0.3, verificationNeed: 0.4 },
      agents: 5,
      cost: 1.5,
    };

    return {
      level: profile.level,
      strategy: { type: "builtin", templateName },
      confidence: 0.85,
      reason: `关键词匹配到内置模板 "${templateName}"`,
      dimensions: profile.dimensions,
      estimatedAgents: profile.agents,
      estimatedCostUsd: profile.cost,
    };
  }

  /** 默认评估（解析失败时降级） */
  private defaultAssessment(task?: TaskDefinition): ComplexityAssessment {
    // 如果有 task 信息，根据内容长度做简单启发式
    if (task) {
      const contentLength = task.content.length;
      const isLikelySimple = contentLength < 50 && !task.dependsOn?.length;

      if (isLikelySimple) {
        return {
          level: "simple",
          strategy: { type: "direct" },
          confidence: 0.4,
          reason: "任务描述简短，降级为直接执行",
          dimensions: { scope: 0.2, uncertainty: 0.3, risk: 0.2, parallelism: 0.1, verificationNeed: 0.2 },
          estimatedAgents: 1,
          estimatedCostUsd: 0.1,
        };
      }
    }

    return {
      level: "moderate",
      strategy: { type: "builtin", templateName: "omx-pipeline" },
      confidence: 0.4,
      reason: "评估降级为标准 pipeline",
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
