import { useState } from "react";
import type { TaskDefinition } from "@ai-workbench/shared";
import { EmptyState } from "../common/EmptyState";
import { Skeleton } from "../common/Skeleton";
import { staggerItemStyle } from "../../hooks/useAnimations";
import { TaskComments } from "./TaskComments";

interface TaskQueueProps {
  queue: TaskDefinition[];
  activeTaskIds: string[];
  runningTasks: TaskDefinition[];
  completedTasks: TaskDefinition[];
  failedTasks: TaskDefinition[];
  runningElapsed: string | null;
  simpleMode: boolean;
  showLoading: boolean;
  isRunning: boolean;
  runId: string | undefined;
  showQueue: boolean;
  runStatus: string | undefined;
  onStart: () => void;
  onSetActiveTask: (taskId: string) => void;
  onMoveTask: (fromIdx: number, toIdx: number) => void;
  onDeleteTask: (taskId: string, content: string) => void;
  onEditTask: (task: TaskDefinition) => void;
  onRetry: (taskId: string) => void;
  onShowAddModal: () => void;
  onCloseQueue: () => void;
  readOnly?: boolean;
}

export function TaskQueue({
  queue,
  activeTaskIds,
  runningTasks,
  completedTasks,
  failedTasks,
  runningElapsed,
  simpleMode,
  showLoading,
  isRunning,
  runId,
  showQueue,
  runStatus,
  onStart,
  onSetActiveTask,
  onMoveTask,
  onDeleteTask,
  onEditTask,
  onRetry,
  onShowAddModal,
  onCloseQueue,
}: TaskQueueProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);

  return (
    <div
      className={`w-72 border-r flex flex-col min-h-0 overflow-hidden max-md:mobile-drawer max-md:mobile-drawer-left ${showQueue ? "" : "max-md:drawer-closed"}`}
      style={{ borderColor: "var(--border)", animation: "fadeIn 0.4s ease-out" }}
    >
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-sm font-bold" style={{ color: "var(--text-secondary)" }}>
          待办 ({queue.length})
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={onShowAddModal}
            className="text-xs px-2 py-1 rounded font-semibold"
            style={{ background: "var(--green)", color: "#fff" }}
          >
            + 添加
          </button>
          <button
            onClick={onCloseQueue}
            className="md:hidden text-xs ml-1"
            style={{ color: "var(--text-secondary)" }}
            aria-label="关闭队列"
          >
            &#10005;
          </button>
        </div>
      </div>

      <div
        role="listbox"
        aria-label="任务队列，可通过拖拽或 Ctrl+上下箭头排序"
        className="flex-1 overflow-y-auto p-2 space-y-1"
        onKeyDown={(e) => {
          if (focusIdx === null || queue.length === 0) return;
          if (e.key === "ArrowUp" && e.ctrlKey && focusIdx > 0) {
            e.preventDefault();
            onMoveTask(focusIdx, focusIdx - 1);
            setFocusIdx(focusIdx - 1);
          } else if (e.key === "ArrowDown" && e.ctrlKey && focusIdx < queue.length - 1) {
            e.preventDefault();
            onMoveTask(focusIdx, focusIdx + 1);
            setFocusIdx(focusIdx + 1);
          }
        }}
      >
        {showLoading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} variant="card" height={56} />
            ))}
          </div>
        ) : queue.length === 0 ? (
          <EmptyState
            title="没有待办任务"
            description={!isRunning ? "点击开始" : undefined}
            action={!isRunning ? { label: runStatus === "completed" ? "继续" : "开始", onClick: onStart } : undefined}
            variant="queue"
          />
        ) : (
          queue.map((task, i) => (
            <div
              key={task.id}
              role="option"
              aria-grabbed={dragIdx === i ? "true" : "false"}
              aria-selected={focusIdx === i ? "true" : "false"}
              aria-roledescription="可拖拽任务项，Ctrl+上下箭头可调整顺序"
              aria-label={`任务 ${i + 1}: ${task.content}，优先级 P${task.priority}`}
              tabIndex={0}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx !== null && dragIdx !== i) onMoveTask(dragIdx, i);
                setDragIdx(null);
              }}
              onDragEnd={() => setDragIdx(null)}
              onFocus={() => setFocusIdx(i)}
              className="group px-3 py-2 rounded text-xs cursor-grab active:cursor-grabbing"
              style={{
                background: activeTaskIds.includes(task.id)
                  ? "rgba(77, 107, 254, 0.1)"
                  : dragIdx === i
                    ? "rgba(77, 107, 254, 0.05)"
                    : "var(--bg-tertiary)",
                border: activeTaskIds.includes(task.id) ? "1px solid var(--blue)" : "1px solid transparent",
                opacity: dragIdx !== null && dragIdx !== i ? 0.7 : dragIdx === i ? 1 : undefined,
                transform: dragIdx === i ? "scale(1.02) rotate(1deg)" : undefined,
                boxShadow: dragIdx === i ? "0 4px 16px rgba(0,0,0,0.4)" : undefined,
                transition: "transform 0.2s, box-shadow 0.2s, opacity 0.2s",
                ...staggerItemStyle(i, 40, "staggerFadeIn", 0.3),
              }}
              onClick={() => onSetActiveTask(task.id)}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0"
                  style={{
                    background: task.type === "user_defined" ? "var(--purple)" : "var(--bg-secondary)",
                    color: task.type === "user_defined" ? "#fff" : "var(--text-secondary)",
                  }}
                >
                  {i + 1}
                </span>
                <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                  {task.content}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditTask(task);
                  }}
                  className="shrink-0 opacity-0 group-hover:opacity-100 duration-200 hover:opacity-100 text-[11px] px-1.5 py-0.5 rounded font-medium"
                  style={{ color: "var(--blue)", border: "1px solid transparent" }}
                  aria-label="编辑任务"
                  title="编辑任务"
                >
                  编辑
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTask(task.id, task.content);
                  }}
                  className="shrink-0 opacity-0 group-hover:opacity-100 duration-200 hover:opacity-100 text-[11px] px-1.5 py-0.5 rounded font-medium"
                  style={{ color: "var(--red)", border: "1px solid transparent" }}
                  aria-label="删除任务"
                  title="删除任务"
                >
                  移除
                </button>
              </div>
              <div className="mt-1 flex gap-2" style={{ color: "var(--text-secondary)" }}>
                <span>{task.type === "user_defined" ? "用户" : "AI"}</span>
                {!simpleMode && <span>P{task.priority}</span>}
                {!simpleMode && <span>{task.timeoutMinutes}min</span>}
              </div>
            </div>
          ))
        )}

        {/* Running task indicator */}
        {runningTasks.length > 0 && (
          <div className="border-t px-2 py-2" style={{ borderColor: "var(--border)" }}>
            {runningTasks.map((task) => (
              <div key={task.id} className="mb-1.5 last:mb-0">
                <div
                  className="px-2 py-1.5 rounded text-xs"
                  style={{ background: "rgba(77, 107, 254, 0.1)", border: "1px solid var(--blue)" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[10px] animate-pulse" style={{ color: "var(--blue)" }}>
                      &#9679;
                    </span>
                    <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                      {task.content}
                    </span>
                  </div>
                  <div className="mt-0.5 flex gap-2 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--blue)" }}>工作中</span>
                    {runningElapsed && <span>{runningElapsed}</span>}
                    <span>{task.type === "user_defined" ? "用户" : "AI"}</span>
                    {task.startedAt && <span>{new Date(task.startedAt).toLocaleTimeString()}</span>}
                  </div>
                </div>
                {runId && (
                  <div className="mt-1.5 px-1">
                    <TaskComments runId={runId} taskId={task.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Completed tasks */}
        {completedTasks.length > 0 && (
          <div
            className="border-t px-2 py-2"
            style={{ borderColor: "var(--border)", maxHeight: "200px", overflowY: "auto" }}
          >
            <h4 className="text-xs font-bold mb-1" style={{ color: "var(--green)" }}>
              已完成 ({completedTasks.length})
            </h4>
            <div className="space-y-1">
              {completedTasks.map((t) => (
                <div
                  key={t.id}
                  className="px-2 py-1.5 rounded text-xs"
                  style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.15)" }}
                >
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 text-[10px] mt-0.5" style={{ color: "var(--green)" }}>
                      &#10003;
                    </span>
                    <span className="flex-1 whitespace-pre-wrap break-words" style={{ color: "var(--text-primary)" }}>
                      {t.content}
                    </span>
                  </div>
                  <div className="mt-0.5 flex gap-2 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                    <span>{t.type === "user_defined" ? "用户" : "AI"}</span>
                    {t.completedAt && <span>{new Date(t.completedAt).toLocaleTimeString()}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Failed tasks with retry */}
        {failedTasks.length > 0 && (
          <div
            className="border-t px-2 py-2"
            style={{ borderColor: "var(--border)", maxHeight: "200px", overflowY: "auto" }}
          >
            <h4 className="text-xs font-bold mb-1" style={{ color: "var(--red)" }}>
              出错了 ({failedTasks.length})
            </h4>
            <div className="space-y-1">
              {failedTasks.map((t) => (
                <div
                  key={t.id}
                  className="px-2 py-1.5 rounded text-xs"
                  style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)" }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                      {t.content}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => onRetry(t.id)}
                        className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                        style={{ background: "var(--blue)", color: "#fff" }}
                      >
                        再试一次
                      </button>
                      <button
                        onClick={() => onDeleteTask(t.id, t.content)}
                        className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                        style={{ background: "var(--red)", color: "#fff" }}
                      >
                        移除
                      </button>
                    </div>
                  </div>
                  {t.errorMessage && (
                    <p
                      className="mt-0.5 text-[10px] truncate"
                      style={{ color: "var(--text-secondary)" }}
                      title={t.errorMessage}
                    >
                      {t.errorMessage}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
