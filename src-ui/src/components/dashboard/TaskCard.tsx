import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ExecutionRun } from "@ai-workbench/shared";
import type { RobotMood } from "@ai-workbench/shared";
import { useTaskStore } from "../../stores/task-store";
import { formatDuration } from "../../lib/utils";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { RobotMascot } from "./RobotMascot";

interface TaskCardProps {
  task: ExecutionRun;
  onDelete?: () => void;
}

const STATUS_CFG: Record<string, { color: string; label: string; mood: RobotMood }> = {
  idle:      { color: "var(--text-secondary)", label: "空闲",   mood: "idle" },
  running:   { color: "var(--blue)",           label: "运行中", mood: "working" },
  paused:    { color: "var(--yellow)",          label: "已暂停", mood: "thinking" },
  completed: { color: "var(--green)",           label: "已完成", mood: "celebrating" },
  failed:    { color: "var(--red)",             label: "失败",   mood: "error" },
};

export function TaskCard({ task, onDelete }: TaskCardProps) {
  const navigate = useNavigate();
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [now, setNow] = useState(Date.now());

  const cfg = STATUS_CFG[task.status] ?? STATUS_CFG.idle;
  const isRemote = task.source === "remote";

  useEffect(() => {
    if (task.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [task.status]);

  const elapsed = task.startedAt
    ? formatDuration((task.completedAt || now) - task.startedAt)
    : "未开始";

  const handleDelete = useCallback(async () => {
    setShowDeleteConfirm(false);
    await deleteTask(task.id);
    onDelete?.();
  }, [deleteTask, task.id, onDelete]);

  const isRunning = task.status === "running";

  return (
    <>
      <div
        className={`glass-card glass-card-hover cursor-pointer group relative ${isRunning ? "marquee-border" : ""}`}
        onClick={() => navigate(`/evolution/${task.id}`)}
      >
        <div className="task-card-inner">
          {/* Left: Pixel robot */}
          <div className="flex-shrink-0 flex items-center justify-center w-16 border-r" style={{ borderColor: "var(--border)" }}>
            <RobotMascot mood={cfg.mood} size={40} />
          </div>

          {/* Right: Task info */}
          <div className="flex-1 p-4 flex flex-col min-w-0">
            {/* Header: status + elapsed + delete */}
            <div className="flex items-center justify-between mb-2">
              <span
                className="status-badge"
                style={{ background: `${cfg.color}20`, color: cfg.color }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />
                {cfg.label}
              </span>
              {isRemote && (
                <span
                  className="status-badge ml-1"
                  style={{ background: "rgba(88, 166, 255, 0.15)", color: "var(--blue)" }}
                >
                  共享
                </span>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {elapsed}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
                  className="w-6 h-6 rounded flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity delete-btn"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
                  title="删除"
                  aria-label="删除任务"
                >
                  &times;
                </button>
              </div>
            </div>

            {/* Title */}
            <p className="text-sm mb-2 line-clamp-2" style={{ color: "var(--text-primary)" }}>
              {task.goals[0] || "未命名任务"}
            </p>

            {/* Footer */}
            <div className="mt-auto text-xs flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="truncate">{(task.workingDir || "").split("/").pop()}</span>
                <span>目标: {task.goals.length} | 已完成: {task.totalTasksCompleted}</span>
              </div>
              {task.totalCostUsd > 0 && (
                <span className="flex-shrink-0 ml-2" style={{ color: "var(--yellow)" }}>
                  ${task.totalCostUsd.toFixed(4)}
                </span>
              )}
            </div>
          </div>
        </div>
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
