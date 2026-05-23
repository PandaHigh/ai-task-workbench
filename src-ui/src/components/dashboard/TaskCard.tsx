import { useNavigate } from "react-router-dom";
import type { ExecutionRun } from "@ai-workbench/shared";

interface TaskCardProps {
  task: ExecutionRun;
}

export function TaskCard({ task }: TaskCardProps) {
  const navigate = useNavigate();

  const statusColor: Record<string, string> = {
    idle: "var(--text-secondary)",
    running: "var(--blue)",
    paused: "var(--yellow)",
    completed: "var(--green)",
    failed: "var(--red)",
  };

  const statusLabel: Record<string, string> = {
    idle: "空闲",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
  };

  const elapsed = task.startedAt
    ? formatDuration(
        (task.completedAt ? task.completedAt.getTime() : Date.now()) -
          task.startedAt.getTime(),
      )
    : "未开始";

  return (
    <div
      className="rounded-lg border p-4 cursor-pointer transition-colors"
      style={{
        background: "var(--bg-secondary)",
        borderColor: "var(--border)",
      }}
      onClick={() => navigate(`/evolution/${task.id}`)}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--blue)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span
          className="status-badge"
          style={{
            background: `${statusColor[task.status]}20`,
            color: statusColor[task.status],
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: statusColor[task.status] }}
          />
          {statusLabel[task.status]}
        </span>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {elapsed}
        </span>
      </div>

      <p className="text-sm mb-3 line-clamp-2" style={{ color: "var(--text-primary)" }}>
        {task.goals[0] || "未命名任务"}
      </p>

      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
        <div>目录: {task.workingDir.split("/").pop()}</div>
        <div>目标: {task.goals.length} | 已完成: {task.totalTasksCompleted}</div>
      </div>

      {task.totalCostUsd > 0 && (
        <div className="text-xs mt-2" style={{ color: "var(--yellow)" }}>
          ${task.totalCostUsd.toFixed(4)}
        </div>
      )}
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
