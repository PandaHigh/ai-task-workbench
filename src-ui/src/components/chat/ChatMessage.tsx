import { useMemo } from "react";
import { marked } from "marked";
import type { ChatMessage as ChatMessageType, ToolCallInfo } from "../../stores/chat-store";

interface ChatMessageProps {
  message: ChatMessageType;
}

function ToolCallBadge({ tc }: { tc: ToolCallInfo }) {
  const isSuccess = tc.status === "completed";
  const isError = tc.status === "error";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        background: isError ? "var(--red-bg, rgba(220,38,38,0.1))" : "var(--bg-tertiary)",
        color: isError ? "var(--red)" : isSuccess ? "var(--green)" : "var(--text-secondary)",
        marginRight: 4,
        marginBottom: 4,
      }}
    >
      {tc.status === "executing" && (
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            border: "2px solid var(--text-secondary)",
            borderTopColor: "transparent",
            animation: "spin 0.6s linear infinite",
          }}
        />
      )}
      {tc.status === "completed" && "✓ "}
      {tc.status === "error" && "✗ "}
      {tc.method}
    </span>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const htmlContent = useMemo(() => {
    if (isUser || isSystem) return message.content;
    try {
      return marked.parse(message.content || "", { async: false }) as string;
    } catch {
      return message.content;
    }
  }, [message.content, isUser, isSystem]);

  if (isSystem) {
    return (
      <div style={{ textAlign: "center", padding: "4px 12px" }}>
        <span
          style={{
            fontSize: 11,
            color: "var(--red)",
            background: "var(--bg-tertiary)",
            padding: "4px 12px",
            borderRadius: 8,
          }}
        >
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        padding: "0 12px",
        marginBottom: 8,
      }}
    >
      <div
        style={{
          maxWidth: isUser ? "80%" : "85%",
          padding: "8px 12px",
          borderRadius: 12,
          fontSize: 13,
          lineHeight: 1.5,
          ...(isUser
            ? { background: "var(--blue)", color: "#fff", borderBottomRightRadius: 4 }
            : {
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                borderBottomLeftRadius: 4,
                color: "var(--text-primary)",
              }),
        }}
      >
        {/* Tool call indicators */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div style={{ marginBottom: 6, display: "flex", flexWrap: "wrap" }}>
            {message.toolCalls.map((tc, i) => (
              <ToolCallBadge key={i} tc={tc} />
            ))}
          </div>
        )}
        {isUser ? (
          <span>{message.content}</span>
        ) : (
          <span className="markdown-body text-xs" dangerouslySetInnerHTML={{ __html: htmlContent }} />
        )}
        {message.isStreaming && <span className="typewriter-cursor" />}
      </div>
    </div>
  );
}
