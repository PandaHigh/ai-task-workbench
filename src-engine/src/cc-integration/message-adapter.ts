import type { CCMessage } from "./cc-client.js";

export interface AdaptedMessage {
  taskId: string;
  type: "progress" | "result" | "error" | "tool" | "system";
  content: string;
  metadata?: Record<string, unknown>;
}

function getProp(msg: CCMessage, key: string): unknown {
  return (msg as unknown as Record<string, unknown>)[key];
}

function isContentArray(content: unknown): content is Array<{ type: string; text?: string }> {
  return Array.isArray(content);
}

export function adaptCCMessage(msg: CCMessage, taskId: string): AdaptedMessage | null {
  switch (msg.type) {
    case "assistant": {
      const content = msg.content;
      if (!isContentArray(content)) {
        const text = typeof content === "string" ? content : "";
        return { taskId, type: "progress", content: text };
      }
      const text = content
        .filter((c) => c.type === "text")
        .map((c) => c.text || "")
        .join("\n") || "";
      return { taskId, type: "progress", content: text };
    }

    case "result":
      if (msg.subtype === "success") {
        return {
          taskId,
          type: "result",
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? ""),
          metadata: {
            totalCostUsd: getProp(msg, "total_cost_usd"),
            durationMs: getProp(msg, "duration_ms"),
            numTurns: getProp(msg, "num_turns"),
          },
        };
      }
      return {
        taskId,
        type: "error",
        content: JSON.stringify(getProp(msg, "errors") || "Unknown error"),
      };

    case "tool_progress":
      return {
        taskId,
        type: "tool",
        content: `Tool: ${getProp(msg, "tool_name")}`,
        metadata: { elapsed: getProp(msg, "elapsed_time_seconds") },
      };

    case "system":
      return {
        taskId,
        type: "system",
        content: `System: ${msg.subtype || "init"}`,
      };

    default:
      return null;
  }
}
