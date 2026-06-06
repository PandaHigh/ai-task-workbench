/**
 * Migration — 内置大规模迁移工作流
 */

import { WorkflowBuilder, agentStage, parallelStages, sequenceStages } from "../workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

export function createMigrationWorkflow(): WorkflowDefinition {
  return WorkflowBuilder.create("migration", "大规模迁移")
    .description("按模块并行迁移 + 验证 + 失败循环")
    .builtIn()
    .tags(["migration", "refactor", "rewrite"])
    .useCase("跨模块/数百文件的大规模代码迁移或重构")
    .stage(
      agentStage({
        type: "agent",
        name: "迁移分析",
        role: "analyst",
        prompt:
          "分析迁移范围和影响：\n1. 列出所有需要迁移的模块/文件\n2. 识别依赖关系\n3. 评估风险\n4. 制定模块级迁移计划\n\n输出格式：每个模块一个迁移任务，包含文件列表和依赖关系。",
      }),
    )
    .stage(
      parallelStages(
        "按模块并行迁移",
        [
          agentStage({
            type: "agent",
            name: "模块迁移执行",
            role: "executor",
            prompt: "执行分配给你的模块迁移任务。严格按照迁移规范操作。完成后输出修改摘要。",
            maxTurns: 40,
          }),
        ],
        { maxConcurrency: 4 },
      ),
    )
    .stage(
      sequenceStages(
        "迁移验证",
        [
          agentStage({
            type: "agent",
            name: "编译验证",
            role: "verifier",
            prompt: "验证迁移后的代码能否正常编译/运行。执行构建和测试，报告结果。",
          }),
          agentStage({
            type: "agent",
            name: "功能验证",
            role: "qa-tester",
            prompt: "验证迁移后的功能是否与迁移前一致。重点关注边界情况和错误处理。",
          }),
        ],
        { loopBackTo: "parallel-migration", maxReviewLoops: 3 },
      ),
    )
    .stage(
      agentStage({
        type: "agent",
        name: "迁移报告",
        role: "architect",
        prompt: "生成迁移总结报告：\n1. 迁移概览\n2. 各模块状态\n3. 遗留问题和风险\n4. 后续建议",
      }),
    )
    .build();
}
