import { useApprovalStore } from "../../stores/approval-store";

interface StreamMessage {
  type: string;
  subtype?: string;
  content?: unknown;
  timestamp?: number;
  result?: string;
  error?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
}

function formatContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) return (block as { text: string }).text;
        return JSON.stringify(block);
      })
      .join("\n");
  }
  return JSON.stringify(content);
}

function MessageBubble({ message }: { message: StreamMessage }) {
  switch (message.type) {
    case "assistant": {
      const text = formatContent(message.content);
      if (!text) return null;
      return (
        <div className="flex gap-2 mb-1">
          <span className="text-blue-400 shrink-0 font-mono text-xs">CC&gt;</span>
          <pre className="text-gray-200 font-mono text-xs whitespace-pre-wrap break-all flex-1">{text}</pre>
        </div>
      );
    }
    case "user": {
      const text = formatContent(message.content);
      if (!text) return null;
      return (
        <div className="flex gap-2 mb-1">
          <span className="text-green-400 shrink-0 font-mono text-xs">&gt;</span>
          <pre className="text-gray-400 font-mono text-xs whitespace-pre-wrap break-all flex-1">{text}</pre>
        </div>
      );
    }
    case "tool_use": {
      const input = formatContent(message.content);
      return (
        <div className="flex gap-2 mb-1">
          <span className="text-amber-400 shrink-0 font-mono text-xs">TOOL</span>
          <pre className="text-gray-400 font-mono text-xs whitespace-pre-wrap break-all flex-1">{input}</pre>
        </div>
      );
    }
    case "tool_result": {
      const output = formatContent(message.content);
      if (!output) return null;
      const truncated = output.length > 500 ? output.slice(0, 500) + "..." : output;
      return (
        <div className="flex gap-2 mb-1">
          <span className="text-cyan-400 shrink-0 font-mono text-xs">OUT</span>
          <pre className="text-gray-500 font-mono text-xs whitespace-pre-wrap break-all flex-1">{truncated}</pre>
        </div>
      );
    }
    case "result": {
      if (message.subtype === "success") {
        return (
          <div className="flex gap-2 mb-1 items-center">
            <span className="text-green-400 shrink-0 font-mono text-xs">OK</span>
            <span className="text-green-400/70 font-mono text-xs">
              {message.duration_ms ? `${(message.duration_ms / 1000).toFixed(1)}s` : ""}
              {message.total_cost_usd ? ` $${message.total_cost_usd.toFixed(4)}` : ""}
              {message.num_turns ? ` ${message.num_turns} turns` : ""}
            </span>
          </div>
        );
      }
      return (
        <div className="flex gap-2 mb-1">
          <span className="text-red-400 shrink-0 font-mono text-xs">ERR</span>
          <pre className="text-red-300 font-mono text-xs whitespace-pre-wrap break-all flex-1">
            {message.error || message.result || "Unknown error"}
          </pre>
        </div>
      );
    }
    case "system":
      return (
        <div className="flex gap-2 mb-1">
          <span className="text-purple-400 shrink-0 font-mono text-xs">SYS</span>
          <pre className="text-gray-500 font-mono text-xs whitespace-pre-wrap break-all flex-1">
            {formatContent(message.content)}
          </pre>
        </div>
      );
    default:
      return null;
  }
}

interface StreamingOutputProps {
  taskId: string;
}

export function StreamingOutput({ taskId }: StreamingOutputProps) {
  const messages = useApprovalStore((s) => s.streamMessages.get(taskId) ?? []);

  if (messages.length === 0) {
    return (
      <div className="text-gray-600 font-mono text-xs py-2">
        Waiting for output...
      </div>
    );
  }

  return (
    <div className="bg-black/30 rounded p-2 max-h-80 overflow-y-auto">
      {messages.map((msg, i) => (
        <MessageBubble key={i} message={msg as StreamMessage} />
      ))}
    </div>
  );
}
