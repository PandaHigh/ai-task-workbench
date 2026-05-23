import { useNavigate } from "react-router-dom";
import type { ExecutionRun } from "@ai-workbench/shared";
import { useTaskStore } from "../../stores/task-store";

interface TaskCardProps {
  task: ExecutionRun;
}

export function TaskCard({ task }: TaskCardProps) {
  const navigate = useNavigate();
  const deleteTask = useTaskStore((s) => s.deleteTask);

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
        (task.completedAt || Date.now()) - task.startedAt,
      )
    : "未开始";

  const color = statusColor[task.status] || statusColor.idle;
  const progress = task.goals.length > 0
    ? Math.min(task.totalTasksCompleted / task.goals.length, 1)
    : 0;

  const visibleGoals = task.goals.slice(0, 2);
  const remainingCount = task.goals.length - 2;

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("确定删除此任务？所有相关数据将被清除。")) {
      await deleteTask(task.id);
    }
  };

  return (
    <div
      className="rounded-lg cursor-pointer group relative"
      style={{
        background: "var(--bg-secondary)",
        border: `1px solid var(--border)`,
        borderLeft: `3px solid ${color}`,
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        transition: "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
      }}
      onClick={() => navigate(`/evolution/${task.id}`)}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.4)";
        e.currentTarget.style.borderColor = "var(--blue)";
        e.currentTarget.style.borderLeftColor = color;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.borderLeftColor = color;
      }}
    >
      {/* Delete button */}
      <button
        onClick={handleDelete}
        className="absolute top-3 right-3 w-6 h-6 rounded flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--red)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
        title="删除"
      >
        &times;
      </button>

      <div className="p-5 pb-3">
        {/* Header: status + elapsed */}
        <div className="flex items-center justify-between mb-4">
          <span
            className="status-badge"
            style={{
              background: `${color}20`,
              color: color,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full inline-block"
              style={{ background: color }}
            />
            {statusLabel[task.status]}
          </span>
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {elapsed}
          </span>
        </div>

        {/* Title */}
        <p
          className="text-base font-semibold mb-4 leading-snug pr-6"
          style={{ color: "var(--text-primary)" }}
        >
          {task.goals[0] || "未命名任务"}
        </p>

        {/* Goals as pills */}
        {task.goals.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {visibleGoals.map((goal, i) => (
              <span
                key={i}
                className="inline-block text-xs px-2 py-0.5 rounded-full truncate max-w-[180px]"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                }}
                title={goal}
              >
                {goal}
              </span>
            ))}
            {remainingCount > 0 && (
              <span
                className="inline-block text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: "var(--bg-tertiary)",
                  color: "var(--blue)",
                  border: "1px solid var(--border)",
                }}
              >
                +{remainingCount} more
              </span>
            )}
          </div>
        )}

        {/* Meta info */}
        <div className="flex items-center gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.6 }}>
              <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75z"/>
            </svg>
            {task.workingDir.split("/").pop()}
          </span>
          <span>
            目标: {task.goals.length} | 已完成: {task.totalTasksCompleted}
          </span>
        </div>

        {/* Cost */}
        {task.totalCostUsd > 0 && (
          <div className="text-xs mt-2 flex items-center gap-1" style={{ color: "var(--yellow)" }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7.75 1v1.25H6.5A2.5 2.5 0 004 4.75v.5A2.5 2.5 0 006.5 7.75h1.25v2.5H5.75a.75.75 0 000 1.5h2v1.25a.75.75 0 001.5 0v-1.25H10.5A2.5 2.5 0 0013 9.25v-.5A2.5 2.5 0 0010.5 6.25H9.25v-2.5h2a.75.75 0 000-1.5h-2V1a.75.75 0 00-1.5 0zm1.5 6.25H10.5a1 1 0 011 1v.5a1 1 0 01-1 1H9.25v-2.5zm-1.5-1.5H6.5a1 1 0 01-1-1v-.5a1 1 0 011-1h1.25v2.5z"/>
            </svg>
            ${task.totalCostUsd.toFixed(4)}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div
        className="h-1 rounded-full overflow-hidden"
        style={{ background: "var(--bg-tertiary)" }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${progress * 100}%`,
            background: color,
            transition: "width 0.4s ease",
          }}
        />
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
