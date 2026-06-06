/**
 * Dead Code — 内置死代码发现工作流
 */

import { WorkflowBuilder, agentStage, parallelStages, adversarialStage } from "../workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

export function createDeadCodeWorkflow(): WorkflowDefinition {
  return WorkflowBuilder.create("dead-code", "死代码发现")
    .description("并行分析 + 对抗性验证 + 清理建议")
    .builtIn()
    .tags(["dead-code", "cleanup", "unused"])
    .useCase("发现不可达代码、未使用的导入/变量/函数")
    .stage(
      parallelStages(
        "并行分析",
        [
          agentStage({
            type: "agent",
            name: "未使用代码分析",
            role: "explorer",
            prompt:
              "扫描代码库查找未使用的代码：\n1. 未使用的导入\n2. 未调用的函数\n3. 未引用的变量\n4. 无导出的模块\n5. 不可达的分支\n\n每个发现包含：文件路径、行号、类型、描述",
          }),
          agentStage({
            type: "agent",
            name: "依赖关系分析",
            role: "analyst",
            prompt:
              "分析模块间的依赖关系：\n1. 查找孤立的模块（不被任何其他模块引用）\n2. 查找循环依赖\n3. 查找仅被死代码引用的模块\n\n输出依赖图和发现。",
          }),
        ],
        { maxConcurrency: 2 },
      ),
    )
    .stage(
      adversarialStage(
        "对抗性验证",
        3,
        "你是代码分析专家。验证以下「死代码」发现是否真的是死代码 — 检查是否有动态引用、反射调用、或间接使用。",
        { passThreshold: 0.6 },
      ),
    )
    .stage(
      agentStage({
        type: "agent",
        name: "清理报告",
        role: "architect",
        prompt:
          "根据验证结果生成死代码清理报告：\n1. 确认的死代码列表\n2. 每项的安全清理方式\n3. 预估可减少的代码量\n4. 清理优先级",
      }),
    )
    .build();
}
