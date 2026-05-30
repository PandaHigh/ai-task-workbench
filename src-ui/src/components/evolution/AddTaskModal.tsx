import { useState } from "react";

interface AddTaskModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string, priority: number) => void;
  defaultPriority?: number;
}

export function AddTaskModal({ open, onClose, onSubmit, defaultPriority = 5 }: AddTaskModalProps) {
  const [text, setText] = useState("");
  const [priority, setPriority] = useState(defaultPriority);

  if (!open) return null;

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text.trim(), priority);
      setText("");
      setPriority(defaultPriority);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="添加任务"
      style={{
        position: "fixed", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0, 0, 0, 0.6)", backdropFilter: "blur(4px)",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-secondary)", border: "1px solid var(--border)",
          borderRadius: "12px", padding: "24px", minWidth: "340px", maxWidth: "480px", width: "90%",
          animation: "slideUp 0.2s ease-out",
        }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>
          添加任务
        </h3>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="描述你的任务..."
          rows={4}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
            if (e.key === "Escape") onClose();
          }}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: "8px",
            background: "var(--bg-tertiary)", color: "var(--text-primary)",
            border: "2px solid var(--blue)", outline: "none",
            fontSize: "14px", lineHeight: 1.6, resize: "none",
            boxSizing: "border-box",
          }}
        />
        <p style={{ margin: "6px 0 0", fontSize: "11px", color: "var(--text-secondary)" }}>
          Ctrl+Enter 快速保存
        </p>
        <div style={{ marginTop: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>优先级</span>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
              {priority <= 2 ? "高" : priority <= 5 ? "中" : "低"}（数值越小越优先）
            </span>
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            {([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                style={{
                  width: "30px", height: "26px", borderRadius: "4px",
                  border: "none", cursor: "pointer", fontSize: "11px", fontWeight: 600,
                  background: p === priority
                    ? (p <= 2 ? "var(--red)" : p <= 5 ? "var(--blue)" : "var(--text-secondary)")
                    : "var(--bg-tertiary)",
                  color: p === priority ? "#fff" : "var(--text-secondary)",
                  opacity: p === priority ? 1 : 0.7,
                  transition: "all 0.15s",
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px", background: "transparent",
              border: "1px solid var(--border)", borderRadius: "8px",
              color: "var(--text-secondary)", cursor: "pointer", fontSize: "13px",
            }}
          >
            取消
          </button>
          <button
            onClick={() => { handleSubmit(); }}
            disabled={!text.trim()}
            style={{
              padding: "8px 20px", background: "var(--green)",
              border: "none", borderRadius: "8px",
              color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 600,
              opacity: text.trim() ? 1 : 0.4,
            }}
          >
            确认添加
          </button>
        </div>
      </div>
    </div>
  );
}
