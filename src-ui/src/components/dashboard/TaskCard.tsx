import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ExecutionRun } from "@ai-workbench/shared";
import { useTaskStore } from "../../stores/task-store";
import { ConfirmDialog } from "../common/ConfirmDialog";

interface TaskCardProps {
  task: ExecutionRun;
  onDelete?: () => void;
}

export function TaskCard({ task, onDelete }: TaskCardProps) {
  const navigate = useNavigate();
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Real-time elapsed time for running tasks
  useEffect(() => {
    if (task.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [task.status]);

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
        (task.completedAt || now) - task.startedAt,
      )
    : "未开始";

  const handleDelete = useCallback(async () => {
    setShowDeleteConfirm(false);
    await deleteTask(task.id);
    onDelete?.();
  }, [deleteTask, task.id, onDelete]);

  return (
    <>
      <div
        className="rounded-lg border p-4 cursor-pointer transition-colors group relative card-hover"
        style={{
          background: "var(--bg-secondary)",
          borderColor: "var(--border)",
        }}
        onClick={() => navigate(`/evolution/${task.id}`)}
      >
        {/* Delete button */}
        <button
          onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
          className="absolute top-2 right-2 w-6 h-6 rounded flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity delete-btn"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
          title="删除"
          aria-label="删除任务"
        >
          &times;
        </button>

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

        <p className="text-sm mb-2 line-clamp-2" style={{ color: "var(--text-primary)" }}>
          {task.goals[0] || "未命名任务"}
        </p>

        {task.terminationConditions.length > 0 && (
          <div className="text-xs mb-2" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>
            <span style={{ color: "var(--yellow)", fontWeight: 600 }}>终止: </span>
            {task.terminationConditions.slice(0, 2).join("; ")}
            {task.terminationConditions.length > 2 && ` +${task.terminationConditions.length - 2}`}
          </div>
        )}

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

      <ConfirmDialog
        open={showDeleteConfirm}
        title="删除任务"
        message="确定删除此任务？所有相关数据将被清除。"
        confirmLabel="删除"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
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
