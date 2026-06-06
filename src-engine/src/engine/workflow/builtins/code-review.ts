/**
 * Code Review — 内置代码审查工作流
 */

import {
  WorkflowBuilder,
  agentStage,
  parallelStages,
} from "../workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

export function createCodeReviewWorkflow(): WorkflowDefinition {
  return WorkflowBuilder.create("code-review", "代码审查")
    .description("多维度并行审查 + 综合评估")
    .builtIn()
    .tags(["review", "quality"])
    .useCase("对代码/PR进行全面审查")
    .stage(parallelStages("并行审查", [
      agentStage({
        type: "agent",
        name: "代码质量审查",
        role: "code-reviewer",
        prompt: "审查代码质量：\n1. 代码规范\n2. 命名一致性\n3. 函数复杂度\n4. 重复代码\n5. 可维护性\n\n列出所有发现的问题和评分（0-1）。",
      }),
      agentStage({
        type: "agent",
        name: "安全审查",
        role: "security-reviewer",
        prompt: "从安全角度审查代码：\n1. 输入验证\n2. 权限检查\n3. 数据保护\n4. 注入风险\n\n列出安全发现和评分（0-1）。",
      }),
      agentStage({
        type: "agent",
        name: "性能审查",
        role: "quality-reviewer",
        prompt: "从性能角度审查代码：\n1. 算法效率\n2. 内存使用\n3. 异步模式\n4. 缓存策略\n\n列出性能问题和评分（0-1）。",
      }),
    ], { maxConcurrency: 3 }))
    .stage(agentStage({
      type: "agent",
      name: "综合评估",
      role: "architect",
      prompt: "综合所有审查维度的结果，生成一份完整的代码审查报告：\n1. 总体评分\n2. 按维度评分\n3. 关键发现列表\n4. 优先修复建议\n5. 积极亮点",
    }))
    .build();
}
