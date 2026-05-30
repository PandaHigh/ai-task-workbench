import { useState, useEffect } from "react";
import { useEngine } from "../../hooks/useEngine";
import type { DetectedError } from "@ai-workbench/shared";

const SEVERITY_CFG: Record<string, { color: string; label: string }> = {
  critical: { color: "var(--red)", label: "严重" },
  warning: { color: "var(--yellow)", label: "警告" },
  info: { color: "var(--blue-light)", label: "信息" },
};

const CATEGORY_LABELS: Record<string, string> = {
  syntax: "语法错误",
  type: "类型错误",
  runtime: "运行时错误",
  import: "导入错误",
  test_failure: "测试失败",
  unknown: "未知错误",
};

interface ErrorStreamProps {
  runId: string;
}

export function ErrorStream({ runId }: ErrorStreamProps) {
  const { call } = useEngine();
  const [errors, setErrors] = useState<DetectedError[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    call("error.history", { runId })
      .then((data) => setErrors(data as DetectedError[]))
      .catch(() => setErrors([]))
      .finally(() => setLoading(false));
  }, [runId, call]);

  if (loading) {
    return <div className="text-xs py-4 text-center" style={{ color: "var(--text-muted)" }}>加载中...</div>;
  }

  if (errors.length === 0) {
    return <div className="text-xs py-4 text-center" style={{ color: "var(--text-muted)" }}>暂无错误记录</div>;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>
        错误记录 ({errors.length})
      </div>
      {errors.slice().reverse().map((error) => {
        const cfg = SEVERITY_CFG[error.severity] ?? SEVERITY_CFG.info;
        return (
          <div
            key={error.id}
            className="p-2 rounded text-xs"
            style={{ background: "var(--bg-tertiary)", borderLeft: `3px solid ${cfg.color}` }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                style={{ background: `${cfg.color}20`, color: cfg.color }}
              >
                {cfg.label}
              </span>
              <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                {CATEGORY_LABELS[error.category] ?? error.category}
              </span>
              {error.file && (
                <span className="text-[10px] font-mono truncate" style={{ color: "var(--blue-light)" }}>
                  {error.file}{error.line ? `:${error.line}` : ""}
                </span>
              )}
              {error.fixTaskId && (
                <span className="text-[10px] ml-auto" style={{ color: "var(--green)" }}>
                  已创建修复任务
                </span>
              )}
            </div>
            <div className="font-mono text-[11px] break-all" style={{ color: "var(--text-primary)" }}>
              {error.message.substring(0, 200)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
