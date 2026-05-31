import { useState, useEffect, useCallback } from "react";
import { useEngine } from "../../hooks/useEngine";
import type { ActivityEvent } from "@ai-workbench/shared";
import { formatTimestamp } from "../../lib/utils";

interface ActivityTimelineProps {
  runId: string;
}

const ACTION_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  "task.created": { label: "创建任务", color: "var(--blue)", icon: "+" },
  "task.started": { label: "开始执行", color: "var(--green)", icon: ">" },
  "task.completed": { label: "任务完成", color: "var(--green)", icon: "✓" },
  "task.failed": { label: "任务失败", color: "var(--red)", icon: "✗" },
  "run.stopped": { label: "暂停运行", color: "var(--yellow)", icon: "||" },
  "approval.responded": { label: "审批响应", color: "var(--purple)", icon: "?" },
  "comment.created": { label: "添加评论", color: "var(--blue)", icon: "#" },
};

export function ActivityTimeline({ runId }: ActivityTimelineProps) {
  const { call } = useEngine();
  const [activities, setActivities] = useState<ActivityEvent[]>([]);

  const load = useCallback(async () => {
    if (!runId) return;
    try {
      const result = (await call("activity.list", { runId, limit: 50 })) as { activities: ActivityEvent[] };
      setActivities(result.activities);
    } catch (err) { console.warn("[ActivityTimeline] load failed:", err instanceof Error ? err.message : err); }
  }, [runId, call]);

  useEffect(() => { load(); }, [load]);

  if (activities.length === 0) {
    return (
      <div className="font-mono text-xs py-4 text-center" style={{ color: "var(--text-muted)" }}>
        暂无活动记录
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
          活动 ({activities.length})
        </span>
        <button onClick={load} className="text-[10px] px-2 py-0.5 rounded" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}>
          刷新
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto space-y-1">
        {[...activities].reverse().map((a) => {
          const meta = ACTION_LABELS[a.action] ?? { label: a.action, color: "var(--text-secondary)", icon: "*" };
          return (
            <div key={a.id} className="flex items-start gap-2 px-2 py-1.5 rounded text-xs" style={{ background: "var(--bg-tertiary)" }}>
              <span className="shrink-0 font-mono font-bold" style={{ color: meta.color }}>{meta.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium" style={{ color: meta.color }}>{meta.label}</span>
                  <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{a.userId}</span>
                  <span className="text-[10px] ml-auto shrink-0" style={{ color: "var(--text-secondary)" }}>{formatTimestamp(a.timestamp)}</span>
                </div>
                {a.details && Object.keys(a.details).length > 0 && (
                  <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                    {Object.entries(a.details).map(([k, v]) => `${k}: ${String(v).substring(0, 40)}`).join(" | ")}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
