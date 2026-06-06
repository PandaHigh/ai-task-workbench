import { useRef, useEffect, useCallback } from "react";
import { useChatStore } from "../../stores/chat-store";
import { useEngine } from "../../hooks/useEngine";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";

const QUICK_HINTS = ["查看我的任务", "创建一个新任务", "某个任务的进度如何？"];

export function MasterChat() {
  const { connected, call } = useEngine();
  const { messages, sessionId, isLoading, setSessionId, addUserMessage, startAssistantMessage, clearChat } =
    useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!connected) return;

      addUserMessage(content);

      let sid = sessionId;
      if (!sid) {
        sid = crypto.randomUUID();
        setSessionId(sid);
      }

      startAssistantMessage();

      try {
        await call("chat.send", { message: content, sessionId: sid });
      } catch (err) {
        useChatStore.getState().setError(err instanceof Error ? err.message : String(err));
      }
    },
    [connected, call, sessionId, setSessionId, addUserMessage, startAssistantMessage],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-primary)" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="var(--blue)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 10c0 .6-.4 1-1 1H5l-3 3V3c0-.6.4-1 1-1h10c.6 0 1 .4 1 1v7z" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>AI 助手</span>
          {!connected && <span style={{ fontSize: 10, color: "var(--red)" }}>未连接</span>}
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            title="清除对话"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              padding: 4,
              borderRadius: 4,
              fontSize: 11,
            }}
          >
            清除
          </button>
        )}
      </div>

      {/* Messages area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
        {messages.length === 0 && (
          <div style={{ padding: "24px 16px", textAlign: "center" }}>
            <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
              你好！我是 PandaAI 总控助手。
              <br />
              我可以帮你管理任务、查看进度、启动执行等。
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {QUICK_HINTS.map((hint) => (
                <button
                  key={hint}
                  onClick={() => handleSend(hint)}
                  disabled={!connected}
                  style={{
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    cursor: connected ? "pointer" : "not-allowed",
                    textAlign: "left",
                    transition: "background 0.15s",
                  }}
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isLoading || !connected} />
    </div>
  );
}
