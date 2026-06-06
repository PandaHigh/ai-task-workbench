import { methodHandlers, methodMeta, type MethodDescriptor } from "../../json-rpc/methods.js";

/** Methods the master agent should NOT call (avoid recursion / internal-only). */
const EXCLUDED_METHODS = new Set([
  "chat.send",
  "chat.history",
  "chat.clear",
  "session.identify",
  "session.list",
  "share.subscribe",
  "share.unsubscribe",
  "share.subscriptions",
  "plugin.install",
  "plugin.remove",
  "plugin.toggle",
]);

/** Dynamically build tool descriptions from methodHandlers + methodMeta. */
export function buildToolDescriptions(): string {
  const allMethods = Object.keys(methodHandlers).filter((m) => !EXCLUDED_METHODS.has(m));
  const lines: string[] = [];

  for (const method of allMethods) {
    const meta: MethodDescriptor | undefined = methodMeta[method];
    if (meta) {
      const paramLines = meta.params
        .map((p) => `    - ${p.name} (${p.type}${p.required ? ", required" : ", optional"}): ${p.description}`)
        .join("\n");
      lines.push(`- "${method}": ${meta.description}\n  Params:\n${paramLines}`);
    } else {
      lines.push(`- "${method}": (No detailed description. Call with appropriate params based on method name.)`);
    }
  }

  return lines.join("\n\n");
}

export function buildSystemPrompt(): string {
  const toolDescriptions = buildToolDescriptions();

  return `你是 PandaAI 总控助手。你可以帮助用户管理所有 AI 编码任务——创建、查看、启动、停止任务等。

你拥有以下操作能力（工具），通过特殊格式调用：

## 可用工具

${toolDescriptions}

## 工具调用格式

当你需要执行操作时，输出如下格式（可以连续多次调用）：

<<TOOL_CALL>>
{"method": "run.list", "params": {}}
<</TOOL_CALL>>

收到工具执行结果后，你会看到：

<<TOOL_RESULT>>
{"success": true, "data": ...}
<</TOOL_RESULT>>

请根据结果用自然语言回复用户。

## 智能路由（Ultracode）

当用户描述一个需要执行的任务时，系统会自动根据任务复杂度选择最优执行策略：
- **简单任务**（修拼写错误、查看状态）：直接快速完成
- **中等任务**（实现功能、修复bug）：走标准 5 阶段 pipeline（访谈→规划→执行→审查→QA）
- **复杂任务**（安全审计、代码审查、大规模迁移）：走并行多 Agent 工作流 + 对抗性验证

当用户消息中包含以下关键词时，应主动建议使用高级工作流模式：
- "全面审查"、"代码库审计"、"安全扫描" → 安全审计工作流
- "大规模迁移"、"重构整个模块" → 迁移工作流
- "所有 bug"、"缺陷巡检" → Bug 巡检工作流

你可以先用 \`router.analyze\` 工具分析任务复杂度，再推荐合适的执行方式。

## 行为准则

- 主动根据用户意图推荐操作
- 列出任务时，用简洁格式展示（状态、名称、进度）
- 当用户想创建任务时，会自动进入头脑风暴模式引导用户
- 回复简洁但完整
- 默认使用中文回复（除非用户使用其他语言）
- 一次最多调用 5 次工具
- 工具调用按顺序执行，不要并发`;
}
