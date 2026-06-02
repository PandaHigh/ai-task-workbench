import { useState, useEffect } from "react";

interface ExistingTask {
  id: string;
  content: string;
}

interface TaskCreateFormProps {
  onSubmit: (params: { content: string; priority: number; timeoutMinutes: number; dependsOn?: string[] }) => void;
  onCancel?: () => void;
  defaultPriority?: number;
  defaultTimeout?: number;
  submitLabel?: string;
  autoFocus?: boolean;
  initialContent?: string;
  existingTasks?: ExistingTask[];
}

export function TaskCreateForm({
  onSubmit,
  onCancel,
  defaultPriority = 5,
  defaultTimeout = 60,
  submitLabel = "确认",
  autoFocus = true,
  initialContent = "",
  existingTasks = [],
}: TaskCreateFormProps) {
  const [content, setContent] = useState(initialContent);
  const [priority, setPriority] = useState(defaultPriority);
  const [timeoutMinutes, setTimeoutMinutes] = useState(defaultTimeout);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dependsOn, setDependsOn] = useState<string[]>([]);

  useEffect(() => {
    setContent(initialContent);
    setPriority(defaultPriority);
    setTimeoutMinutes(defaultTimeout);
  }, [initialContent, defaultPriority, defaultTimeout]);

  const canSubmit = content.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      content: content.trim(), priority, timeoutMinutes,
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
    });
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
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (canSubmit) handleSubmit(); }
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
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            data-testid="priority-select"
          >
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i + 1} value={i + 1}>P{i + 1}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span>超时</span>
          <select
            value={timeoutMinutes}
            onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
            className="px-1.5 py-0.5 rounded text-[10px] outline-none"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            data-testid="timeout-select"
          >
            {[15, 30, 60, 90, 120, 180].map((v) => (
              <option key={v} value={v}>{v}分钟</option>
            ))}
          </select>
        </div>
      </div>

      {existingTasks.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-[10px] underline" style={{ color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer" }}>
            {showAdvanced ? "收起高级选项" : "高级选项（依赖任务）"}
          </button>
        </div>
      )}

      {showAdvanced && (
        <div className="space-y-2 p-2 rounded" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
          {existingTasks.length > 0 && (
            <div>
              <label className="text-[10px] block mb-1" style={{ color: "var(--text-secondary)" }}>依赖任务（完成后才执行）</label>
              <div className="flex flex-wrap gap-1">
                {existingTasks.map((task) => (
                  <button key={task.id} type="button" onClick={() => {
                    setDependsOn((prev) => prev.includes(task.id) ? prev.filter((d) => d !== task.id) : [...prev, task.id]);
                  }}
                    className="px-1.5 py-0.5 rounded text-[10px] max-w-[200px] truncate"
                    style={{
                      background: dependsOn.includes(task.id) ? "var(--blue)" : "var(--bg-secondary)",
                      color: dependsOn.includes(task.id) ? "#fff" : "var(--text-secondary)",
                      border: `1px solid ${dependsOn.includes(task.id) ? "var(--blue)" : "var(--border)"}`,
                    }}
                    title={task.content}
                  >
                    {task.content}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>Ctrl+Enter 快速提交</p>

      <div className="flex gap-2 justify-end">
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>取消</button>
        )}
        <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="px-4 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: "var(--green)", color: "#fff" }}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
