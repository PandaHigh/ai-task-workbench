/**
 * Workflow Generator — AI 动态生成 workflow
 *
 * 借鉴 Claude Code 的核心能力：AI 根据任务描述动态编写编排脚本。
 * 通过 CC 调用让 AI 分析任务并生成结构化的 WorkflowDefinition JSON。
 */

import { CCClient } from "../../cc-integration/cc-client.js";
import { WorkflowBuilder, agentStage, parallelStages, sequenceStages, loopStages, adversarialStage } from "./workflow-builder.js";
import type { WorkflowDefinition, WorkflowStage } from "./workflow-types.js";
import type { TaskDefinition } from "@ai-workbench/shared";

export interface GenerateOptions {
  workingDir: string;
  /** 可用的内置模板名称列表，帮助 AI 决定是否复用 */
  availableTemplates?: string[];
  /** 预算剩余（美元） */
  budgetRemaining?: number;
}

export class WorkflowGenerator {
  private ccClient: CCClient;

  constructor(ccClient?: CCClient) {
    this.ccClient = ccClient ?? new CCClient();
  }

  /**
   * 让 AI 分析任务并动态生成一个 WorkflowDefinition。
   */
  async generate(task: TaskDefinition, options: GenerateOptions): Promise<WorkflowDefinition> {
    const prompt = this.buildGeneratorPrompt(task, options);

    const stream = this.ccClient.executeTaskStream(prompt, {
      workingDir: options.workingDir,
      timeoutMinutes: 2,
      maxTurns: 1,
      systemPrompt: GENERATOR_SYSTEM_PROMPT,
      disallowedTools: [
        "AskUserQuestion", "Bash", "Read", "Write", "Edit",
        "Glob", "Grep", "WebSearch", "WebFetch", "Agent",
      ],
    });

    let responseText = "";
    for await (const msg of stream) {
      if (msg.type === "assistant") {
        const content = (msg as unknown as Record<string, unknown>);
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

    return this.parseGeneratedWorkflow(responseText, task);
  }

  private buildGeneratorPrompt(task: TaskDefinition, options: GenerateOptions): string {
    const templates = options.availableTemplates?.join(", ") ?? "omx-pipeline, security-audit, code-review, bug-sweep, migration, dead-code";

    return `请为以下任务设计一个 WorkflowDefinition。

## 任务内容
${task.content}

## 任务详细信息
${task.promptJson ? task.promptJson.substring(0, 1000) : "（无详细信息）"}

## 可用内置模板
${templates}

## 预算剩余
$${(options.budgetRemaining ?? Infinity) === Infinity ? "无限制" : (options.budgetRemaining ?? 0).toFixed(2)}

## 要求

1. 分析任务的并行化机会
2. 确定需要哪些角色/视角
3. 设计验证策略（是否需要对抗性审查）
4. 输出结构化的 JSON

## 阶段类型

- agent: 单 Agent 执行（需指定 role 和 prompt）
- parallel: 子阶段并行执行
- sequence: 子阶段顺序执行（可设 loopBackTo + maxReviewLoops 实现审查循环）
- loop: 条件循环（需设 maxIterations）
- adversarial: 对抗性验证（需设 voterCount、passThreshold、voterPrompt）

## 可用角色
explore, analyst, planner, architect, debugger, executor, verifier,
quality-reviewer, security-reviewer, code-reviewer,
test-engineer, designer, qa-tester, git-master, code-simplifier, researcher,
product-manager, metis, momus, oracle

## 输出格式

严格输出 JSON：
{
  "name": "workflow 显示名",
  "description": "简短描述",
  "tags": ["tag1", "tag2"],
  "stages": [
    {
      "type": "agent",
      "name": "阶段名",
      "role": "角色ID",
      "prompt": "该阶段的指令..."
    },
    {
      "type": "parallel",
      "name": "并行扫描",
      "stages": [
        { "type": "agent", "name": "...", "role": "...", "prompt": "..." },
        { "type": "agent", "name": "...", "role": "...", "prompt": "..." }
      ]
    },
    {
      "type": "adversarial",
      "name": "对抗性验证",
      "voterCount": 3,
      "passThreshold": 0.6,
      "voterPrompt": "尝试反驳以下发现..."
    }
  ]
}`;
  }

  private parseGeneratedWorkflow(text: string, task: TaskDefinition): WorkflowDefinition {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      // 解析失败，返回默认的简单 workflow
      return this.fallbackWorkflow(task);
    }

    try {
      const parsed = JSON.parse(jsonMatch[1]);
      return this.buildFromParsed(parsed, task);
    } catch {
      return this.fallbackWorkflow(task);
    }
  }

  private buildFromParsed(parsed: Record<string, unknown>, _task: TaskDefinition): WorkflowDefinition {
    const builder = WorkflowBuilder.create(
      `dynamic-${Date.now()}`,
      typeof parsed.name === "string" ? parsed.name : "动态工作流",
    )
      .description(typeof parsed.description === "string" ? parsed.description : "AI 动态生成的工作流");

    if (Array.isArray(parsed.tags)) {
      builder.tags(parsed.tags as string[]);
    }

    if (Array.isArray(parsed.stages)) {
      for (const stageDef of parsed.stages as Record<string, unknown>[]) {
        const stage = this.parseStageDef(stageDef);
        if (stage) builder.stage(stage);
      }
    }

    return builder.build();
  }

  private parseStageDef(def: Record<string, unknown>): WorkflowStage | null {
    const type = def.type as string;
    const name = (def.name as string) ?? "unnamed";
    const prompt = (def.prompt as string) ?? "";
    const gateThreshold = typeof def.gateThreshold === "number" ? def.gateThreshold : undefined;

    switch (type) {
      case "agent":
        return agentStage({
          type: "agent",
          name,
          role: (def.role as string) ?? "executor",
          prompt,
          gateThreshold,
          maxTurns: typeof def.maxTurns === "number" ? def.maxTurns : undefined,
        });

      case "parallel": {
        const subStages = Array.isArray(def.stages)
          ? (def.stages as Record<string, unknown>[]).map((s) => this.parseStageDef(s)).filter(Boolean) as WorkflowStage[]
          : [];
        return parallelStages(name, subStages, {
          maxConcurrency: typeof def.maxConcurrency === "number" ? def.maxConcurrency : undefined,
          gateThreshold,
        });
      }

      case "sequence": {
        const subStages = Array.isArray(def.stages)
          ? (def.stages as Record<string, unknown>[]).map((s) => this.parseStageDef(s)).filter(Boolean) as WorkflowStage[]
          : [];
        return sequenceStages(name, subStages, {
          gateThreshold,
          loopBackTo: typeof def.loopBackTo === "string" ? def.loopBackTo : undefined,
          maxReviewLoops: typeof def.maxReviewLoops === "number" ? def.maxReviewLoops : undefined,
        });
      }

      case "loop": {
        const bodyStages = Array.isArray(def.body)
          ? (def.body as Record<string, unknown>[]).map((s) => this.parseStageDef(s)).filter(Boolean) as WorkflowStage[]
          : [];
        return loopStages(name, bodyStages, typeof def.maxIterations === "number" ? def.maxIterations : 5, {
          consensus: typeof def.consensus === "boolean" ? def.consensus : undefined,
          gateThreshold,
        });
      }

      case "adversarial":
        return adversarialStage(
          name,
          typeof def.voterCount === "number" ? def.voterCount : 3,
          (def.voterPrompt as string) ?? "尝试反驳以下发现，找出不正确或不完整的部分",
          {
            passThreshold: typeof def.passThreshold === "number" ? def.passThreshold : undefined,
            gateThreshold,
          },
        );

      default:
        console.warn(`[workflow-generator] Unknown stage type: ${type}`);
        return null;
    }
  }

  private fallbackWorkflow(task: TaskDefinition): WorkflowDefinition {
    // 解析失败时返回一个简单的单 Agent workflow
    return WorkflowBuilder.create(`fallback-${Date.now()}`, "降级工作流")
      .description("AI 生成失败，降级为单 Agent 执行")
      .stage(agentStage({
        type: "agent",
        name: "执行任务",
        role: "executor",
        prompt: task.content,
      }))
      .build();
  }
}

const GENERATOR_SYSTEM_PROMPT = `你是一个工作流设计专家。根据用户描述的任务，设计一个最优的多 Agent 工作流。

设计原则：
1. 能并行的尽量并行（如：多维度审查可以同时进行）
2. 高风险任务加对抗性验证（如：安全审计、生产代码变更）
3. 不确定的任务先探索再执行（如：先 explore 再 plan）
4. 控制总 agent 数量在预算范围内
5. 只输出 JSON，不输出其他文字`;
