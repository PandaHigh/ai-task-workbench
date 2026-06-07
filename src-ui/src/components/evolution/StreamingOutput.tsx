import { useState } from "react";
import { useApprovalStore } from "../../stores/approval-store";

interface StreamMessage {
  type: string;
  subtype?: string;
  content?: unknown;
  timestamp?: number;
  result?: string;
  error?: string;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  // tool_use specific fields from Claude CLI stream-json
  name?: string;
  input?: unknown;
  tool_use_id?: string;
}

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  [key: string]: unknown;
}

/**
 * Format content blocks from Claude CLI stream-json output.
 * Handles:
 * - string content
 * - array of content blocks (text, thinking, tool_use, etc.)
 * - null/undefined content
 */
function formatContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object") {
          const b = block as ContentBlock;
          // Standard text block
          if (b.text) return b.text;
          // Thinking block — extracted separately for rich display
          // (handled in ThinkingBlock, not here)
          if (b.type === "thinking" && b.thinking) return "";
          // Redacted thinking block
          if (b.type === "redacted_thinking") return "[思考内容已编辑]";
          // Tool use block within content array
          if (b.type === "tool_use" && b.name) {
            return `[调用工具: ${b.name}]`;
          }
          // Tool result block within content array
          if (b.type === "tool_result") {
            const resultContent = b.content;
            if (typeof resultContent === "string") return resultContent;
            if (Array.isArray(resultContent)) {
              return resultContent
                .map((r) => (r && typeof r === "object" && "text" in r ? (r as { text: string }).text : ""))
                .filter(Boolean)
                .join("\n");
            }
          }
          return "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object") return JSON.stringify(content);
  return String(content);
}

/**
 * Extract thinking blocks from assistant message content array.
 */
function extractThinkingBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (block) =>
      block &&
      typeof block === "object" &&
      ((block as ContentBlock).type === "thinking" || (block as ContentBlock).type === "redacted_thinking"),
  ) as ContentBlock[];
}

/**
 * Format tool_use message into a human-readable string.
 * Claude CLI sends tool_use with { name, input } not { content }.
 */
function formatToolUse(message: StreamMessage): string {
  // If content is already a string, use it directly
  if (typeof message.content === "string" && message.content) return message.content;

  // If content is an array with text blocks, use those
  if (Array.isArray(message.content)) {
    const text = formatContent(message.content);
    if (text) return text;
  }

  // Build from name + input (the common case for tool_use messages)
  const toolName = message.name || "unknown";
  const input = message.input;

  if (input && typeof input === "object") {
    // Show key fields concisely
    const entries = Object.entries(input as Record<string, unknown>);
    const formatted = entries
      .map(([key, val]) => {
        if (typeof val === "string") {
          // Truncate long string values
          const truncated = val.length > 200 ? val.slice(0, 200) + "..." : val;
          return `${key}: ${truncated}`;
        }
        return `${key}: ${JSON.stringify(val)}`;
      })
      .join(", ");
    return `${toolName}(${formatted})`;
  }

  if (input && typeof input === "string") return `${toolName}: ${input}`;

  return toolName;
}

/**
 * Format tool_result for display, with smart truncation.
 */
function formatToolResult(content: unknown): string {
  if (content == null) return "";
  let text = "";

  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object") {
          // tool_result content can have { type: "text", text: "..." } blocks
          if ("text" in block) return (block as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  } else if (typeof content === "object") {
    text = JSON.stringify(content);
  }

  if (!text) return "";
  return text.length > 500 ? text.slice(0, 500) + "..." : text;
}

// ─── ThinkingBlock: collapsible thinking display ─────────────────────────────

function ThinkingBlock({ blocks }: { blocks: ContentBlock[] }) {
  const [expanded, setExpanded] = useState(false);
  const thinkingText = blocks
    .map((b) => {
      if (b.type === "thinking" && b.thinking) return b.thinking;
      if (b.type === "redacted_thinking") return "[思考内容已编辑]";
      return "";
    })
    .filter(Boolean)
    .join("\n");

  if (!thinkingText) return null;

  const preview = thinkingText.length > 80 ? thinkingText.slice(0, 80) + "..." : thinkingText;

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs font-mono cursor-pointer w-full text-left"
        style={{ color: "var(--text-muted)", background: "none", border: "none", padding: 0 }}
      >
        <span
          className="inline-block transition-transform duration-150"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
        <span style={{ opacity: 0.7 }}>💭 思考过程</span>
      </button>
      {expanded && (
        <div
          className="mt-1 ml-3 pl-2 text-xs font-mono whitespace-pre-wrap break-all"
          style={{
            color: "var(--text-muted)",
            borderLeft: "2px solid var(--border)",
            maxHeight: "300px",
            overflowY: "auto",
          }}
        >
          {thinkingText}
        </div>
      )}
      {!expanded && (
        <div
          className="ml-3 pl-2 text-xs font-mono whitespace-pre-wrap break-all"
          style={{ color: "var(--text-muted)", opacity: 0.5, borderLeft: "2px solid var(--border)" }}
        >
          {preview}
        </div>
      )}
    </div>
  );
}

// ─── ToolCallBlock: formatted tool invocation display ─────────────────────────

function ToolCallBlock({ message }: { message: StreamMessage }) {
  const [expanded, setExpanded] = useState(false);
  const display = formatToolUse(message);
  const toolName = message.name || "";
  const hasInput = !!(message.input && typeof message.input === "object");

  return (
    <div className="flex gap-2 mb-1">
      <span className="shrink-0 font-mono text-xs font-semibold" style={{ color: "var(--yellow)" }}>
        🔧 TOOL
      </span>
      <div className="flex-1 min-w-0">
        <button
          onClick={() => hasInput && setExpanded(!expanded)}
          className="font-mono text-xs text-left w-full cursor-pointer"
          style={{
            color: "var(--text-secondary)",
            background: "none",
            border: "none",
            padding: 0,
          }}
        >
          {hasInput && <span style={{ opacity: 0.5 }}>{expanded ? "▾ " : "▸ "}</span>}
          {toolName && (
            <span className="font-semibold" style={{ color: "var(--yellow)" }}>
              {toolName}
            </span>
          )}
          {!expanded && toolName && display !== toolName && (
            <span style={{ color: "var(--text-muted)" }}>
              {" "}
              {display.slice(toolName.length).slice(0, 100)}
              {display.length > toolName.length + 100 ? "..." : ""}
            </span>
          )}
          {!toolName && display}
        </button>
        {expanded && hasInput && (
          <pre
            className="mt-1 text-xs font-mono whitespace-pre-wrap break-all"
            style={{
              color: "var(--text-muted)",
              background: "var(--bg-tertiary)",
              padding: "4px 8px",
              borderRadius: "4px",
              maxHeight: "200px",
              overflowY: "auto",
            }}
          >
            {JSON.stringify(message.input, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── MessageBubble: renders a single stream message ──────────────────────────

function MessageBubble({ message }: { message: StreamMessage }) {
  const baseCls = "flex gap-2 mb-1";
  const labelCls = "shrink-0 font-mono text-xs";
  const preCls = "font-mono text-xs whitespace-pre-wrap break-all flex-1";

  switch (message.type) {
    case "assistant": {
      // Extract thinking blocks for separate display
      const thinkingBlocks = extractThinkingBlocks(message.content);
      const text = formatContent(message.content);
      const hasThinking = thinkingBlocks.length > 0;
      const hasText = !!text;

      if (!hasThinking && !hasText) return null;

      return (
        <div className="mb-1">
          {/* Thinking section (collapsible) */}
          {hasThinking && <ThinkingBlock blocks={thinkingBlocks} />}
          {/* Main text output */}
          {hasText && (
            <div className={baseCls}>
              <span className={labelCls} style={{ color: "var(--blue)" }}>
                CC&gt;
              </span>
              <pre className={preCls} style={{ color: "var(--text-primary)" }}>
                {text}
              </pre>
            </div>
          )}
        </div>
      );
    }
    case "user": {
      const text = formatContent(message.content);
      if (!text) return null;
      return (
        <div className={baseCls}>
          <span className={labelCls} style={{ color: "var(--green)" }}>
            &gt;
          </span>
          <pre className={preCls} style={{ color: "var(--text-secondary)" }}>
            {text}
          </pre>
        </div>
      );
    }
    case "tool_use": {
      return <ToolCallBlock message={message} />;
    }
    case "tool_result": {
      const output = formatToolResult(message.content);
      if (!output) return null;
      return (
        <div className={baseCls}>
          <span className={labelCls} style={{ color: "var(--blue-light)" }}>
            📋 OUT
          </span>
          <pre className={preCls} style={{ color: "var(--text-muted)" }}>
            {output}
          </pre>
        </div>
      );
    }
    case "result": {
      if (message.subtype === "success") {
        return (
          <div className={`${baseCls} items-center`}>
            <span className={labelCls} style={{ color: "var(--green)" }}>
              ✅ OK
            </span>
            <span className="font-mono text-xs" style={{ color: "var(--green)", opacity: 0.7 }}>
              {message.duration_ms ? `${(message.duration_ms / 1000).toFixed(1)}s` : ""}
              {message.num_turns ? ` ${message.num_turns} turns` : ""}
              {message.total_cost_usd != null ? ` $${message.total_cost_usd.toFixed(4)}` : ""}
            </span>
          </div>
        );
      }
      return (
        <div className={baseCls}>
          <span className={labelCls} style={{ color: "var(--red)" }}>
            ❌ ERR
          </span>
          <pre className={preCls} style={{ color: "var(--red)" }}>
            {message.error || message.result || "Unknown error"}
          </pre>
        </div>
      );
    }
    case "system":
      return (
        <div className={baseCls}>
          <span className={labelCls} style={{ color: "var(--purple)" }}>
            ⚙️ SYS
          </span>
          <pre className={preCls} style={{ color: "var(--text-muted)" }}>
            {formatContent(message.content)}
          </pre>
        </div>
      );
    default:
      return null;
  }
}

// ─── StreamingOutput: main component ─────────────────────────────────────────

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
