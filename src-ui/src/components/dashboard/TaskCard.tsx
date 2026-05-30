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
  idle:      { color: "var(--text-secondary)", label: "准备中", mood: "idle" },
  running:   { color: "var(--blue-light)",     label: "工作中", mood: "working" },
  paused:    { color: "var(--yellow)",          label: "已暂停", mood: "thinking" },
  completed: { color: "var(--green)",           label: "已完成", mood: "celebrating" },
  failed:    { color: "var(--red)",             label: "出错了", mood: "error" },
};

export function TaskCard({ task, onDelete }: TaskCardProps) {
  const navigate = useNavigate();
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [now, setNow] = useState(Date.now());

  const cfg = STATUS_CFG[task.status] ?? STATUS_CFG.idle;
  const isRemote = task.source === "remote";
  const isRunning = task.status === "running";

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isRunning]);

  const elapsed = task.startedAt
    ? formatDuration((task.completedAt || now) - task.startedAt)
    : "未开始";

  const handleDelete = useCallback(async () => {
    setShowDeleteConfirm(false);
    if (isRemote) {
      try {
        const { engineClient } = await import("../../lib/engine-client");
        await engineClient.call("share.unsubscribe", { runId: task.id });
      } catch (err) {
        console.warn("Failed to unsubscribe:", err instanceof Error ? err.message : err);
      }
    }
    await deleteTask(task.id);
    onDelete?.();
  }, [deleteTask, task.id, onDelete, isRemote]);

  return (
    <>
      <div
        className={`card card-hover cursor-pointer group relative ${isRunning ? "task-running-indicator" : ""}`}
        onClick={() => navigate(`/evolution/${task.id}`)}
      >
        <div className="task-card-inner">
          {/* Left: Pixel robot */}
          <div className="flex-shrink-0 flex items-center justify-center w-14 border-r" style={{ borderColor: "var(--border)" }}>
            <RobotMascot mood={cfg.mood} size={36} />
          </div>

          {/* Right: Task info */}
          <div className="flex-1 p-3 flex flex-col min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <span
                className="status-badge"
                style={{ background: `${cfg.color}15`, color: cfg.color }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />
                {cfg.label}
              </span>
              {isRemote && (
                <span
                  className="status-badge ml-1"
                  style={{ background: "rgba(77, 107, 254, 0.12)", color: "var(--blue-light)" }}
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
                  className="w-5 h-5 rounded flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 max-md:opacity-50 transition-opacity delete-btn"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
                  title="删除"
                  aria-label="删除任务"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="2" y1="2" x2="8" y2="8" />
                    <line x1="8" y1="2" x2="2" y2="8" />
                  </svg>
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
                <span>已完成 {task.totalTasksCompleted}/{Math.max(task.totalTasksCompleted, task.goals.length)} 项</span>
              </div>
              {task.totalCostUsd > 0 && (
                <span className="flex-shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--yellow)" }}>
                  ${task.totalCostUsd.toFixed(2)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title={isRemote ? "取消订阅" : "删除任务"}
        message={isRemote ? "确定取消订阅此共享任务？本地数据将被清除。" : "确定删除此任务？所有相关数据将被清除。"}
        confirmLabel={isRemote ? "取消订阅" : "删除"}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
