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
  const baseCls = "flex gap-2 mb-1";
  const labelCls = "shrink-0 font-mono text-xs";
  const preCls = "font-mono text-xs whitespace-pre-wrap break-all flex-1";

  switch (message.type) {
    case "assistant": {
      const text = formatContent(message.content);
      if (!text) return null;
      return (
        <div className={baseCls}>
          <span className={labelCls} style={{ color: "var(--blue)" }}>CC&gt;</span>
          <pre className={preCls} style={{ color: "var(--text-primary)" }}>{text}</pre>
        </div>
      );
    }
    case "user": {
      const text = formatContent(message.content);
      if (!text) return null;
      return (
        <div className={baseCls}>
          <span className={labelCls} style={{ color: "var(--green)" }}>&gt;</span>
          <pre className={preCls} style={{ color: "var(--text-secondary)" }}>{text}</pre>
        </div>
      );
    }
    case "tool_use": {
      const input = formatContent(message.content);
      return (
        <div className={baseCls}>
          <span className={labelCls} style={{ color: "var(--yellow)" }}>TOOL</span>
          <pre className={preCls} style={{ color: "var(--text-secondary)" }}>{input}</pre>
        </div>
      );
    }
    case "tool_result": {
      const output = formatContent(message.content);
      if (!output) return null;
      const truncated = output.length > 500 ? output.slice(0, 500) + "..." : output;
      return (
        <div className={baseCls}>
          <span className={labelCls} style={{ color: "var(--blue-light)" }}>OUT</span>
          <pre className={preCls} style={{ color: "var(--text-muted)" }}>{truncated}</pre>
        </div>
      );
    }
    case "result": {
      if (message.subtype === "success") {
        return (
          <div className={`${baseCls} items-center`}>
            <span className={labelCls} style={{ color: "var(--green)" }}>OK</span>
            <span className="font-mono text-xs" style={{ color: "var(--green)", opacity: 0.7 }}>
              {message.duration_ms ? `${(message.duration_ms / 1000).toFixed(1)}s` : ""}
              {message.total_cost_usd ? ` $${message.total_cost_usd.toFixed(4)}` : ""}
              {message.num_turns ? ` ${message.num_turns} turns` : ""}
            </span>
          </div>
        );
      }
      return (
        <div className={baseCls}>
          <span className={labelCls} style={{ color: "var(--red)" }}>ERR</span>
          <pre className={preCls} style={{ color: "var(--red)" }}>
            {message.error || message.result || "Unknown error"}
          </pre>
        </div>
      );
    }
    case "system":
      return (
        <div className={baseCls}>
          <span className={labelCls} style={{ color: "var(--purple)" }}>SYS</span>
          <pre className={preCls} style={{ color: "var(--text-muted)" }}>
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

const EMPTY_MESSAGES: unknown[] = [];

export function StreamingOutput({ taskId }: StreamingOutputProps) {
  const messages = useApprovalStore((s) => s.streamMessages.get(taskId) || EMPTY_MESSAGES);

  if (messages.length === 0) {
    return (
      <div className="font-mono text-xs py-2" style={{ color: "var(--text-muted)" }}>
        Waiting for output...
      </div>
    );
  }

  return (
    <div className="rounded-lg p-2 max-h-80 overflow-y-auto" style={{ background: "var(--bg-tertiary)" }}>
      {messages.map((msg, i) => (
        <MessageBubble key={i} message={msg as StreamMessage} />
      ))}
    </div>
  );
}
