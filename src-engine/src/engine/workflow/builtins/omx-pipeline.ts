/**
 * OMX Pipeline — 内置 workflow 模板
 *
 * 将现有 OMX 5 阶段流程包装为 WorkflowDefinition 内置模板。
 * 这样所有复杂任务都统一走 WorkflowRuntime，OMX Pipeline 变成一个可复用的模板。
 *
 * 5 阶段：deep-interview → ralplan → ultragoal → code-review → ultraqa
 */

import {
  WorkflowBuilder,
  agentStage,
  sequenceStages,
  loopStages,
} from "../workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

export function createOmxPipelineWorkflow(): WorkflowDefinition {
  return WorkflowBuilder.create("omx-pipeline", "OMX Pipeline (5阶段)")
    .description("标准 5 阶段执行流程：深度访谈 → RALPLAN共识规划 → 目标执行 → 代码审查 → QA测试")
    .builtIn()
    .tags(["standard", "default", "multi-step"])
    .useCase("中等复杂度任务的默认执行路径 — 单任务多步骤、需要规划")
    .stage(agentStage({
      type: "agent",
      name: "深度访谈",
      role: "metis",
      prompt: `你是一个需求分析专家。请与用户/系统沟通，澄清以下任务的详细需求：

1. 明确任务目标和验收标准
2. 识别关键约束条件和边界情况
3. 确认优先级和依赖关系
4. 记录任何不确定的点

输出格式：
- 任务理解: ...
- 约束条件: ...
- 验收标准: ...
- 风险点: ...
- 需要澄清的问题: ...

如果任务描述已经足够清晰（短任务、具体指令），可以简化输出。`,
      gateThreshold: 0.6,
    }))
    .stage(loopStages("RALPLAN 共识规划", [
      agentStage({
        type: "agent",
        name: "起草计划",
        role: "planner",
        prompt: `你是一个执行计划制定专家。根据任务需求和约束条件，制定一个具体的执行计划。

输出格式：
## 执行计划
1. 理解: 任务核心需求分析
2. 步骤: 详细的执行步骤列表
3. 目标文件: 需要修改/创建的文件
4. 风险: 潜在风险和应对方案
5. 测试策略: 如何验证实现正确性`,
      }),
      agentStage({
        type: "agent",
        name: "架构审查",
        role: "architect",
        prompt: `你是一个架构审查专家。请审查以下执行计划的技术正确性：

1. 步骤是否完整且顺序正确？
2. 文件修改是否合理？
3. 是否有遗漏的边界情况？
4. 测试策略是否充分？

如果计划合理，回复 APPROVED 并说明理由。
如果需要修改，回复 REJECTED 并给出具体建议。`,
      }),
      agentStage({
        type: "agent",
        name: "对抗批评",
        role: "momus",
        prompt: `你是一个严厉的批评家。请挑战以下执行计划：

1. 找出计划中可能失败的地方
2. 质疑假设的合理性
3. 提出更好的替代方案（如果有）
4. 检查是否有遗漏的关键步骤

如果你认为计划足够好（没有致命缺陷），回复 APPROVED。
如果你发现严重问题，回复 REJECTED 并说明具体问题。`,
      }),
    ], 10, { consensus: true, gateThreshold: 0.7 }))
    .stage(agentStage({
      type: "agent",
      name: "目标执行",
      role: "executor",
      prompt: `你是一个代码执行专家。根据以下计划和上下文，实现代码变更：

1. 严格按照执行计划的步骤操作
2. 遵循项目的代码规范
3. 确保代码正确、完整
4. 编写必要的测试

工作目录中已有 CLAUDE.md 文件描述了项目规范，请参考执行。

完成后，输出你做了哪些修改的摘要。`,
      maxTurns: 40,
    }))
    .stage(sequenceStages("代码审查", [
      agentStage({
        type: "agent",
        name: "架构审查",
        role: "architect",
        prompt: `审查代码变更的架构合理性：
1. 变更是否符合项目架构？
2. 是否引入了不必要的耦合？
3. 是否有性能问题？
4. 代码是否遵循项目规范？

输出格式：
- 审查结果: APPROVED / REJECTED
- 评分: 0.0-1.0
- 发现的问题: ...
- 建议: ...`,
        gateThreshold: 0.7,
      }),
      agentStage({
        type: "agent",
        name: "对抗审查",
        role: "momus",
        prompt: `严格审查代码变更，寻找问题：
1. 潜在 bug 或逻辑错误
2. 安全漏洞
3. 边界情况未处理
4. 代码质量问题

如果你找不到严重问题，回复 APPROVED。
如果你发现了严重问题，回复 REJECTED 并详细说明。`,
        gateThreshold: 0.7,
      }),
    ], { loopBackTo: "ralplan", maxReviewLoops: 2 }))
    .stage(agentStage({
      type: "agent",
      name: "QA 测试",
      role: "test-engineer",
      prompt: `执行 QA 测试验证：

1. 运行现有测试确保没有回归
2. 检查新增功能是否按预期工作
3. 验证边界情况
4. 检查错误处理

输出格式：
- 测试通过: 是/否
- 新增测试: ...
- 发现的问题: ...
- 覆盖率评估: ...`,
      gateThreshold: 0.6,
    }))
    .build();
}
