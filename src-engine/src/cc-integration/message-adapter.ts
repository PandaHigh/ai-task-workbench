import type { CCMessage } from "./cc-client.js";

export interface AdaptedMessage {
  taskId: string;
  type: "progress" | "result" | "error" | "tool" | "system";
  content: string;
  metadata?: Record<string, unknown>;
}

export function adaptCCMessage(msg: CCMessage, taskId: string): AdaptedMessage | null {
  switch (msg.type) {
    case "assistant": {
      const content = msg.content as Array<{ type: string; text?: string }>;
      const text = content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text || "")
        .join("\n") || "";
      return { taskId, type: "progress", content: text };
    }

    case "result":
      if (msg.subtype === "success") {
        return {
          taskId,
          type: "result",
          content: (msg.content as string) || "",
          metadata: {
            totalCostUsd: (msg as Record<string, unknown>).total_cost_usd,
            durationMs: (msg as Record<string, unknown>).duration_ms,
            numTurns: (msg as Record<string, unknown>).num_turns,
          },
        };
      }
      return {
        taskId,
        type: "error",
        content: JSON.stringify((msg as Record<string, unknown>).errors || "Unknown error"),
      };

    case "tool_progress":
      return {
        taskId,
        type: "tool",
        content: `Tool: ${(msg as Record<string, unknown>).tool_name}`,
        metadata: { elapsed: (msg as Record<string, unknown>).elapsed_time_seconds },
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
