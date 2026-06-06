import { useState, useEffect } from "react";

interface TaskCreateFormProps {
  onSubmit: (params: { content: string; priority: number; timeoutMinutes: number }) => void;
  onCancel?: () => void;
  defaultPriority?: number;
  defaultTimeout?: number;
  submitLabel?: string;
  autoFocus?: boolean;
  initialContent?: string;
}

export function TaskCreateForm({
  onSubmit,
  onCancel,
  defaultPriority = 5,
  defaultTimeout = 60,
  submitLabel = "确认",
  autoFocus = true,
  initialContent = "",
}: TaskCreateFormProps) {
  const [content, setContent] = useState(initialContent);
  const [priority, setPriority] = useState(defaultPriority);
  const [timeoutMinutes, setTimeoutMinutes] = useState(defaultTimeout);

  useEffect(() => {
    setContent(initialContent);
    setPriority(defaultPriority);
    setTimeoutMinutes(defaultTimeout);
  }, [initialContent, defaultPriority, defaultTimeout]);

  const canSubmit = content.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ content: content.trim(), priority, timeoutMinutes });
  };

  return (
    <div className="space-y-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="描述你的任务..."
        rows={4}
        className="w-full px-3 py-2 rounded-lg text-xs outline-none resize-none"
        style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "2px solid var(--blue)" }}
        autoFocus={autoFocus}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (canSubmit) handleSubmit();
          }
          if (e.key === "Escape") onCancel?.();
        }}
        data-testid="task-content-input"
      />

      <div className="flex items-center gap-4 text-[10px]" style={{ color: "var(--text-secondary)" }}>
        <div className="flex items-center gap-1">
          <span>优先级</span>
          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="px-1.5 py-0.5 rounded text-[10px] outline-none"
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
            }}
            data-testid="priority-select"
          >
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                P{i + 1}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span>超时</span>
          <select
            value={timeoutMinutes}
            onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
            className="px-1.5 py-0.5 rounded text-[10px] outline-none"
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
            }}
            data-testid="timeout-select"
          >
            {[15, 30, 60, 90, 120, 180].map((v) => (
              <option key={v} value={v}>
                {v}分钟
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
        Ctrl+Enter 快速提交
      </p>

      <div className="flex gap-2 justify-end">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-xs"
            style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            取消
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-4 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
          style={{ background: "var(--green)", color: "#fff" }}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
