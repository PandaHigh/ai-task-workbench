import { useNavigate } from "react-router-dom";
import type { ExecutionRun } from "@ai-workbench/shared";
import { useTaskStore } from "../../stores/task-store";

interface TaskCardProps {
  task: ExecutionRun;
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  idle:      { color: "var(--yellow)",  label: "等待中" },
  running:   { color: "var(--blue)",    label: "运行中" },
  paused:    { color: "var(--yellow)",  label: "已暂停" },
  completed: { color: "var(--green)",   label: "已完成" },
  failed:    { color: "var(--red)",     label: "失败" },
  cancelled: { color: "var(--text-secondary)", label: "已取消" },
};

const PILL_COLORS = [
  "var(--blue)", "var(--green)", "var(--yellow)",
  "var(--red)", "var(--text-secondary)",
];

export function TaskCard({ task }: TaskCardProps) {
  const navigate = useNavigate();
  const deleteTask = useTaskStore((s) => s.deleteTask);

  const cfg = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.idle;
  const pct = task.goals.length > 0
    ? Math.min(100, Math.round((task.totalTasksCompleted / task.goals.length) * 100))
    : 0;

  const elapsed = task.startedAt
    ? formatDuration((task.completedAt || Date.now()) - task.startedAt)
    : "未开始";

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("确定删除此任务？所有相关数据将被清除。")) {
      await deleteTask(task.id);
    }
  };

  return (
    <div
      className="rounded-lg border cursor-pointer transition-colors group relative overflow-hidden"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "var(--border)",
        borderLeft: `4px solid ${cfg.color}`,
      }}
      onClick={() => navigate(`/evolution/${task.id}`)}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--blue)";
        e.currentTarget.style.borderLeftColor = cfg.color;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.borderLeftColor = cfg.color;
      }}
    >
      <div className="p-4">
        {/* Header: status badge + elapsed + delete */}
        <div className="flex items-center justify-between mb-2">
          <span
            className="status-badge"
            style={{ background: `${cfg.color}20`, color: cfg.color }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />
            {cfg.label}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {elapsed}
            </span>
            <button
              onClick={handleDelete}
              className="w-6 h-6 rounded flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--red)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
              title="删除"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Title */}
        <p className="text-sm font-medium mb-2 line-clamp-2" style={{ color: "var(--text-primary)" }}>
          {task.goals[0] || "未命名任务"}
        </p>

        {/* Progress bar */}
        <div className="h-1 rounded-full mb-3" style={{ background: "var(--border)" }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${pct}%`,
              background: cfg.color,
              opacity: pct > 0 ? 1 : 0.2,
            }}
          />
        </div>

        {/* Goal pill badges */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {task.goals.slice(0, 3).map((goal, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-tight max-w-[180px] truncate"
              style={{
                background: `${PILL_COLORS[i % PILL_COLORS.length]}15`,
                color: PILL_COLORS[i % PILL_COLORS.length],
                border: `1px solid ${PILL_COLORS[i % PILL_COLORS.length]}30`,
              }}
            >
              {goal}
            </span>
          ))}
          {task.goals.length > 3 && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px]"
              style={{ color: "var(--text-secondary)" }}
            >
              +{task.goals.length - 3}
            </span>
          )}
        </div>

        {/* Footer: directory + cost */}
        <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-secondary)" }}>
          <span>{task.workingDir.split("/").pop()}</span>
          {task.totalCostUsd > 0 && (
            <span style={{ color: "var(--yellow)" }}>
              ${task.totalCostUsd.toFixed(4)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
