/**
 * Bug Sweep — 内置 Bug 巡检工作流
 */

import {
  WorkflowBuilder,
  agentStage,
  adversarialStage,
} from "../workflow-builder.js";
import { loopStages } from "../workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

export function createBugSweepWorkflow(): WorkflowDefinition {
  return WorkflowBuilder.create("bug-sweep", "Bug 巡检")
    .description("持续发现 Bug 直到收敛 + 对抗性验证")
    .builtIn()
    .tags(["bug", "sweep", "discovery"])
    .useCase("全代码库 Bug 发现、缺陷巡检")
    .stage(loopStages("持续发现", [
      agentStage({
        type: "agent",
        name: "Bug 发现",
        role: "explorer",
        prompt: `扫描代码库查找 Bug。重点关注：

1. 空指针/未定义引用
2. 异步操作错误
3. 竞态条件
4. 资源泄漏
5. 错误处理缺失
6. 类型转换问题
7. 边界条件未处理

每个发现格式：
[BUG-ID] | [severity:critical/major/minor] | [confidence:0-1] | [标题] | [描述]

注意：只报告你确信是真正 Bug 的问题，不要报告风格偏好或可能的改进。`,
      }),
    ], 5, { consensus: false }))
    .stage(adversarialStage("对抗性验证", 3,
      "你是 Bug 验证专家。仔细检查以下 Bug 报告，尝试反驳每个发现 — 它是否真的是 Bug？严重程度是否准确？",
      { passThreshold: 0.6 },
    ))
    .stage(agentStage({
      type: "agent",
      name: "Bug 报告",
      role: "architect",
      prompt: "根据经过验证的 Bug 发现，生成一份 Bug 报告。\n\n包含：\n1. 执行摘要（总发现数、按严重程度分布）\n2. 通过验证的 Bug 列表\n3. 每个 Bug 的详情和修复建议\n4. 优先修复顺序",
    }))
    .build();
}
