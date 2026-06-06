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

## 行为准则

- 主动根据用户意图推荐操作
- 列出任务时，用简洁格式展示（状态、名称、进度）
- 当用户想创建任务时，会自动进入头脑风暴模式引导用户
- 回复简洁但完整
- 默认使用中文回复（除非用户使用其他语言）
- 一次最多调用 5 次工具
- 工具调用按顺序执行，不要并发`;
}
