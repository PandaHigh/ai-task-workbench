import { useState, useEffect } from "react";
import type { UserTaskTemplate } from "@ai-workbench/shared";

interface TaskCreateFormProps {
  onSubmit: (params: { content: string; priority: number; timeoutMinutes: number; dependsOn?: string[]; condition?: string }) => void;
  onCancel?: () => void;
  defaultPriority?: number;
  defaultTimeout?: number;
  templates?: UserTaskTemplate[];
  submitLabel?: string;
  autoFocus?: boolean;
  initialContent?: string;
  existingTaskIds?: string[];
}

export function TaskCreateForm({
  onSubmit,
  onCancel,
  defaultPriority = 5,
  defaultTimeout = 60,
  templates = [],
  submitLabel = "确认",
  autoFocus = true,
  initialContent = "",
  existingTaskIds = [],
}: TaskCreateFormProps) {
  const [content, setContent] = useState(initialContent);
  const [priority, setPriority] = useState(defaultPriority);
  const [timeoutMinutes, setTimeoutMinutes] = useState(defaultTimeout);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [condition, setCondition] = useState("");

  useEffect(() => {
    setContent(initialContent);
    setPriority(defaultPriority);
    setTimeoutMinutes(defaultTimeout);
  }, [initialContent, defaultPriority, defaultTimeout]);

  const canSubmit = content.trim().length > 0;

  const applyTemplate = (tpl: UserTaskTemplate) => {
    setContent(tpl.content);
    setPriority(tpl.priority);
    setTimeoutMinutes(tpl.timeoutMinutes);
    setShowTemplates(false);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      content: content.trim(), priority, timeoutMinutes,
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
      ...(condition.trim() ? { condition: condition.trim() } : {}),
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

      {(templates?.length ?? 0) > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowTemplates(!showTemplates)}
            className="text-[10px] px-2 py-1 rounded"
            style={{ color: "var(--text-secondary)", background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}
          >
            {showTemplates ? "收起模板" : "使用模板"}
          </button>
          {showTemplates && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {templates.map((tpl) => (
                <button
                  type="button"
                  key={tpl.id}
                  onClick={() => applyTemplate(tpl)}
                  className="px-2 py-1 rounded text-[10px]"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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

      {existingTaskIds.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-[10px] underline" style={{ color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer" }}>
            {showAdvanced ? "收起高级选项" : "高级选项（依赖、条件）"}
          </button>
        </div>
      )}

      {showAdvanced && (
        <div className="space-y-2 p-2 rounded" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
          {existingTaskIds.length > 0 && (
            <div>
              <label className="text-[10px] block mb-1" style={{ color: "var(--text-secondary)" }}>依赖任务（完成后才执行）</label>
              <div className="flex flex-wrap gap-1">
                {existingTaskIds.map((id) => (
                  <button key={id} type="button" onClick={() => {
                    setDependsOn((prev) => prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]);
                  }}
                    className="px-1.5 py-0.5 rounded text-[10px]"
                    style={{
                      background: dependsOn.includes(id) ? "var(--blue)" : "var(--bg-secondary)",
                      color: dependsOn.includes(id) ? "#fff" : "var(--text-secondary)",
                      border: `1px solid ${dependsOn.includes(id) ? "var(--blue)" : "var(--border)"}`,
                    }}
                  >
                    {id.substring(0, 8)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="text-[10px] block mb-1" style={{ color: "var(--text-secondary)" }}>执行条件（JavaScript 表达式）</label>
            <input type="text" value={condition} onChange={(e) => setCondition(e.target.value)}
              placeholder='例: lastScore >= 0.8 或 lastStatus === "passed"'
              className="w-full px-2 py-1.5 rounded text-xs outline-none"
              style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            />
            <p className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              可用变量: lastScore, lastStatus, cycleCount, completedCount, failedCount
            </p>
          </div>
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
