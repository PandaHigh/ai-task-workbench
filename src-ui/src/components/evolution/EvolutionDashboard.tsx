import { useParams, useNavigate } from "react-router-dom";
import { useEvolutionStore } from "../../stores/evolution-store";
import { useTaskStore } from "../../stores/task-store";
import { RobotMascot } from "../dashboard/RobotMascot";
import { useEngine } from "../../hooks/useEngine";
import { ENGINE_HTTP_URL } from "../../lib/platform";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { TaskDefinition, GitCommit, LessonLearned, ExecutionRun } from "@ai-workbench/shared";
import { EmptyState } from "../common/EmptyState";
import { Skeleton } from "../common/Skeleton";
import { useToast } from "../common/Toast";
import { formatDuration, formatTimestamp } from "../../lib/utils";
import { pageEnterStyle, staggerItemStyle } from "../../hooks/useAnimations";
import { marked } from "marked";
import { ApprovalPanel } from "./ApprovalPanel";
import { StreamingOutput } from "./StreamingOutput";
import { FeatureBoard } from "./FeatureBoard";
import { PresencePanel } from "./PresencePanel";
import { ActivityTimeline } from "./ActivityTimeline";
import { TaskComments } from "./TaskComments";
import { TraceTimeline } from "./TraceTimeline";
import { AgentProgressPanel } from "./AgentProgressPanel";
import { ErrorStream } from "./ErrorStream";
import { ReviewSuggestions } from "./ReviewSuggestions";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { DashboardErrorBoundary } from "./DashboardErrorBoundary";
import { LogSearchBar } from "./LogSearchBar";
import { AddTaskModal } from "./AddTaskModal";
import { useElapsedTimer } from "../../hooks/useElapsedTimer";
import { SharePanel } from "../share/SharePanel";
import { TaskCreateForm } from "../common/TaskCreateForm";

type TabType = "logs" | "commits" | "lessons" | "features" | "activity" | "trace" | "errors" | "suggestions" | "report";

const GOAL_STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  pursuing: { label: "追踪中", color: "var(--blue)", bg: "rgba(77, 107, 254,0.15)" },
  paused: { label: "已暂停", color: "var(--yellow)", bg: "rgba(234,179,8,0.15)" },
  achieved: { label: "已达成", color: "var(--green)", bg: "rgba(16, 185, 129,0.15)" },
  unmet: { label: "进行中", color: "var(--red)", bg: "rgba(239, 68, 68,0.15)" },
  budget_exhausted: { label: "预算已用完", color: "var(--red)", bg: "rgba(239, 68, 68,0.15)" },
};

function formatGoalDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatGoalTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 0 : 1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function EvolutionDashboard() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { connected, call } = useEngine();
  const tasks = useTaskStore((s) => s.tasks);
  const storeRun = tasks.find((t) => t.id === runId);
  const [fetchedRun, setFetchedRun] = useState<ExecutionRun | null>(null);
  const run = storeRun || fetchedRun;

  const queue = useEvolutionStore((s) => s.queue);
  const logs = useEvolutionStore((s) => s.logs);
  const commits = useEvolutionStore((s) => s.commits);
  const lessons = useEvolutionStore((s) => s.lessons);
  const isRunning = useEvolutionStore((s) => s.isRunning);
  const activeTaskId = useEvolutionStore((s) => s.activeTaskId);
  const setQueue = useEvolutionStore((s) => s.setQueue);
  const addLog = useEvolutionStore((s) => s.addLog);
  const setLogs = useEvolutionStore((s) => s.setLogs);
  const setCommits = useEvolutionStore((s) => s.setCommits);
  const setLessons = useEvolutionStore((s) => s.setLessons);
  const setRunning = useEvolutionStore((s) => s.setRunning);
  const setActiveTask = useEvolutionStore((s) => s.setActiveTask);
  const reset = useEvolutionStore((s) => s.reset);

  const [tab, setTab] = useState<TabType>("activity");
  const [simpleMode, setSimpleMode] = useState(() => localStorage.getItem("ui-mode") !== "detailed");
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const showLoading = loading || !connected;
  const [showQueue, setShowQueue] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; content: string } | null>(null);
  const [failedTasks, setFailedTasks] = useState<TaskDefinition[]>([]);
  const [showSharePanel, setShowSharePanel] = useState(false);
  const [completedTasks, setCompletedTasks] = useState<TaskDefinition[]>([]);
  const [runningTask, setRunningTask] = useState<TaskDefinition | null>(null);
  const [showAdvancedPanel, setShowAdvancedPanel] = useState(false);
  const [stopTarget, setStopTarget] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<TaskDefinition | null>(null);
  const [filteredLogs, setFilteredLogs] = useState<typeof logs>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const handleShare = () => setShowSharePanel(true);

  // Load data on mount — only reset when runId changes
  const prevRunIdRef = useRef(runId);
  useEffect(() => {
    if (!runId || !connected) return;
    let cancelled = false;
    const runIdChanged = prevRunIdRef.current !== runId;
    prevRunIdRef.current = runId;
    if (runIdChanged) {
      reset();
      setLoading(true);
    }

    const load = async () => {
      // Load run itself (needed when page is refreshed directly — taskStore is empty)
      if (!storeRun) {
        try {
          const allRuns = (await call("run.list")) as ExecutionRun[];
          if (cancelled) return;
          useTaskStore.setState({ tasks: allRuns });
          const found = allRuns.find((r) => r.id === runId);
          if (found) {
            setFetchedRun(found);
            setRunning(found.status === "running");
          }
          else { if (!cancelled) navigate("/"); return; }
        } catch (err) {
          console.warn("Failed to load run:", err instanceof Error ? err.message : err);
          if (!cancelled) navigate("/");
          return;
        }
      }

      try {
        const qRes = await call("queue.list", { runId });
        if (cancelled) return;
        setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
      } catch (err) {
        console.warn("Failed to load queue:", err instanceof Error ? err.message : err);
        toast.error("加载任务队列出错了");
      }

      try {
        const c = await call("run.commits", { runId });
        if (cancelled) return;
        setCommits((c as GitCommit[]) || []);
      } catch (err) {
        console.warn("Failed to load commits:", err instanceof Error ? err.message : err);
        toast.error("加载保存记录出错了");
      }

      try {
        const l = await call("run.lessons", { runId });
        if (cancelled) return;
        setLessons((l as LessonLearned[]) || []);
      } catch (err) {
        console.warn("Failed to load lessons:", err instanceof Error ? err.message : err);
        toast.error("加载经验经验出错了");
      }

      try {
        const historyLogs = (await call("run.logs", { runId })) as Array<{ id: number; timestamp: number; level: string; source: string; message: string }>;
        if (cancelled) return;
        setLogs(historyLogs);
      } catch { /* ignore */ }

      try {
        const allTasks = (await call("run.tasks", { runId })) as TaskDefinition[];
        if (cancelled) return;
        setFailedTasks(allTasks.filter((t) => t.status === "failed" || t.status === "reverted"));
        setCompletedTasks(allTasks.filter((t) => t.status === "completed"));
        setRunningTask(allTasks.find((t) => t.status === "running") || null);
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [runId, connected]);

  // Periodically refresh all tasks (completed/failed), queue, and run data while running
  useEffect(() => {
    if (!runId || !connected) return;
    const POLL_INTERVAL = connected ? 10_000 : 30_000;
    const interval = setInterval(async () => {
      try {
        const allTasks = (await call("run.tasks", { runId })) as TaskDefinition[];
        setCompletedTasks(allTasks.filter((t) => t.status === "completed"));
        setFailedTasks(allTasks.filter((t) => t.status === "failed" || t.status === "reverted"));
        setRunningTask(allTasks.find((t) => t.status === "running") || null);
        const qRes = await call("queue.list", { runId });
        setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
        const allRuns = (await call("run.list")) as ExecutionRun[];
        const freshRun = allRuns.find((r) => r.id === runId);
        if (freshRun) {
          setFetchedRun(freshRun);
          useTaskStore.getState().updateTask(runId, freshRun);
          setRunning(freshRun.status === "running");
        }
        try { setCommits((await call("run.commits", { runId })) as GitCommit[]); } catch { /* ignore */ }
        try { setLessons((await call("run.lessons", { runId })) as LessonLearned[]); } catch { /* ignore */ }
      } catch { /* ignore */ }
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [runId, call, connected]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const refreshTabData = useCallback(async (t: TabType) => {
    if (!runId) return;
    if (t === "commits") {
      try { setCommits((await call("run.commits", { runId })) as GitCommit[]); } catch (err) { console.warn("Failed to refresh commits:", err instanceof Error ? err.message : err); }
    } else if (t === "lessons") {
      try { setLessons((await call("run.lessons", { runId })) as LessonLearned[]); } catch (err) { console.warn("Failed to refresh lessons:", err instanceof Error ? err.message : err); }
    }
  }, [runId, call]);

  const handleTabChange = (t: TabType) => {
    setTab(t);
    refreshTabData(t);
  };

  const handleStart = async () => {
    if (!runId) return;
    setActionLoading("start");
    try {
      await call("task.start", { runId });
      setRunning(true);
      toast.success("任务已开始");
    } catch (err) {
      addLog({ timestamp: Date.now(), level: "error", source: "engine", message: `启动出错了: ${err}` });
      toast.error(`启动出错了: ${err instanceof Error ? err.message : err}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async () => {
    if (!runId) return;
    setActionLoading("stop");
    try {
      await call("run.stop", { runId });
      setRunning(false);
      addLog({ timestamp: Date.now(), level: "info", source: "engine", message: "执行已停止" });
      toast.info("执行已停止");
    } catch (err) {
      console.warn("Stop failed:", err instanceof Error ? err.message : err);
      toast.error("停止出错了");
    } finally {
      setActionLoading(null);
      setStopTarget(null);
    }
  };

  const handleReorder = async (taskIds: string[]) => {
    if (!runId) return;
    try {
      await call("queue.reorder", { runId, taskIds });
      const qRes = await call("queue.list", { runId });
      setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
    } catch (err) {
      console.warn("Queue reorder failed:", err instanceof Error ? err.message : err);
    }
  };

  const moveTask = (fromIdx: number, toIdx: number) => {
    const ids = queue.map((t) => t.id);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    handleReorder(ids);
  };

  const handleAddTask = async (text: string, priority: number, timeoutMinutes?: number) => {
    if (!runId || !text.trim()) return;
    try {
      await call("task.create", { runId, content: text.trim(), type: "user_defined", priority, timeoutMinutes });
      const qRes = await call("queue.list", { runId });
      setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
      toast.success("任务已添加到队列");
    } catch (err) { toast.error(`添加任务出错了: ${err instanceof Error ? err.message : err}`); }
  };

  const handleRetry = async (taskId: string) => {
    if (!runId) return;
    try {
      await call("task.retry", { runId, taskId });
      const qRes = await call("queue.list", { runId });
      setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
      const allTasks = (await call("run.tasks", { runId })) as TaskDefinition[];
      setFailedTasks(allTasks.filter((t) => t.status === "failed" || t.status === "reverted"));
      setRunningTask(allTasks.find((t) => t.status === "running") || null);
      toast.success("任务已开始");
    } catch (err) { toast.error(`重试出错了: ${err instanceof Error ? err.message : err}`); }
  };

  const handleDeleteTask = (taskId: string, content: string) => {
    setDeleteTarget({ id: taskId, content });
  };

  const confirmDeleteTask = async () => {
    if (!runId || !deleteTarget) return;
    try {
      await call("queue.remove", { runId, taskId: deleteTarget.id });
      const qRes = await call("queue.list", { runId });
      setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
      const allTasks = (await call("run.tasks", { runId })) as TaskDefinition[];
      setFailedTasks(allTasks.filter((t) => t.status === "failed" || t.status === "reverted"));
      toast.success("任务已删除");
    } catch (err) { toast.error(`删除任务出错了: ${err instanceof Error ? err.message : err}`); }
    finally { setDeleteTarget(null); }
  };
  const closeDrawers = () => {
    setShowQueue(false);
    setShowPanel(false);
  };

  const elapsed = run?.startedAt ? formatDuration((run.completedAt || Date.now()) - run.startedAt) : "—";
  const budgetUsed = run?.totalCostUsd ?? 0;
  const budgetMax = 50;
  const budgetPct = Math.min(100, (budgetUsed / budgetMax) * 100);
  const runningElapsed = useElapsedTimer(runningTask?.startedAt);
  const displayLogs = filteredLogs.length > 0 ? filteredLogs : logs;
  const handleFilteredLogsChange = useCallback((filtered: typeof logs) => setFilteredLogs(filtered), []);

  return (
    <>
    <ApprovalPanel />
    <div className="flex-1 flex overflow-hidden" style={pageEnterStyle()}>
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div
          className="px-6 py-3 border-b flex items-center justify-between max-md:px-3"
          style={{ borderColor: "var(--border)", animation: "slideDown 0.3s ease-out" }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => { reset(); navigate("/"); }} className="text-xs px-2 py-1 rounded hover:opacity-80 shrink-0" style={{ color: "var(--text-secondary)" }} aria-label="返回">←</button>
            <h2 className="text-sm font-bold truncate">任务详情</h2>
            <span className="text-xs hidden md:inline" style={{ color: "var(--text-secondary)" }}>{runId?.substring(0, 8)}</span>
            {run && <span className="text-xs px-2 py-0.5 rounded hidden md:inline" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}>{run.workingDir.split("/").pop()}</span>}
            <span className="text-xs hidden md:inline" style={{ color: "var(--text-secondary)" }}>{elapsed}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Download ZIP button */}
            <button
              onClick={() => window.open(`${ENGINE_HTTP_URL}/api/runs/${runId}/download`)}
              className="text-xs px-3 py-1.5 rounded font-semibold hidden md:inline"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              title="下载工作目录 ZIP"
            >
              下载
            </button>
            {/* Share button */}
            <button
              onClick={handleShare}
              className="text-xs px-3 py-1.5 rounded font-semibold hidden md:inline"
              style={{ background: "var(--blue)", color: "#fff" }}
            >
              分享
            </button>
            {/* Mobile drawer toggles */}
            <button onClick={() => { setShowQueue(true); setShowPanel(false); }} className="md:hidden text-xs px-2 py-1 rounded" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }} aria-label="打开任务队列">☰ 待办</button>
            <button onClick={() => { setShowPanel(true); setShowQueue(false); }} className="md:hidden text-xs px-2 py-1 rounded" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }} aria-label="打开操作">⚙ 操作</button>
            <RobotMascot mood={isRunning ? "working" : run?.status === "completed" ? "celebrating" : "idle"} size={32} />
            <span className="status-badge hidden md:inline" style={{
              background: isRunning ? "rgba(77, 107, 254, 0.15)" : run?.status === "completed" ? "rgba(16, 185, 129, 0.15)" : "rgba(125, 133, 144, 0.15)",
              color: isRunning ? "var(--blue)" : run?.status === "completed" ? "var(--green)" : "var(--text-secondary)",
            }}>
              {isRunning ? "工作中" : run?.status === "completed" ? "已完成" : run?.status === "failed" ? "出错了" : "准备中"}
            </span>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Task Queue - desktop: always visible sidebar, mobile: drawer */}
          <DashboardErrorBoundary name="任务队列">
          <div
            className={`w-72 border-r flex flex-col min-h-0 overflow-hidden max-md:mobile-drawer max-md:mobile-drawer-left ${showQueue ? "" : "max-md:drawer-closed"}`}
            style={{ borderColor: "var(--border)", animation: "fadeIn 0.4s ease-out" }}
          >
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-sm font-bold" style={{ color: "var(--text-secondary)" }}>待办 ({queue.length})</h3>
              {queue.length > 0 && (
                <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}></span>
              )}
              <button onClick={() => setShowQueue(false)} className="md:hidden text-xs ml-2" style={{ color: "var(--text-secondary)" }} aria-label="关闭队列">✕</button>
            </div>
            {/* Add task input removed — now in modal */}
            <div role="listbox" aria-label="任务队列，可通过拖拽或 Ctrl+上下箭头排序" className="flex-1 overflow-y-auto p-2 space-y-1" onKeyDown={(e) => {
              if (focusIdx === null || queue.length === 0) return;
              if (e.key === "ArrowUp" && e.ctrlKey && focusIdx > 0) {
                e.preventDefault();
                moveTask(focusIdx, focusIdx - 1);
                setFocusIdx(focusIdx - 1);
              } else if (e.key === "ArrowDown" && e.ctrlKey && focusIdx < queue.length - 1) {
                e.preventDefault();
                moveTask(focusIdx, focusIdx + 1);
                setFocusIdx(focusIdx + 1);
              }
            }}>
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
                  action={!isRunning ? { label: run?.status === "completed" ? "继续" : "开始", onClick: handleStart } : undefined}
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
                    onDrop={() => { if (dragIdx !== null && dragIdx !== i) moveTask(dragIdx, i); setDragIdx(null); }}
                    onDragEnd={() => setDragIdx(null)}
                    onFocus={() => setFocusIdx(i)}
                    className="group px-3 py-2 rounded text-xs cursor-grab active:cursor-grabbing"
                    style={{
                      background: task.id === activeTaskId ? "rgba(77, 107, 254, 0.1)" : dragIdx === i ? "rgba(77, 107, 254, 0.05)" : "var(--bg-tertiary)",
                      border: task.id === activeTaskId ? "1px solid var(--blue)" : "1px solid transparent",
                      opacity: dragIdx !== null && dragIdx !== i ? 0.7 : dragIdx === i ? 1 : undefined,
                      transform: dragIdx === i ? "scale(1.02) rotate(1deg)" : undefined,
                      boxShadow: dragIdx === i ? "0 4px 16px rgba(0,0,0,0.4)" : undefined,
                      transition: "transform 0.2s, box-shadow 0.2s, opacity 0.2s",
                      ...staggerItemStyle(i, 40, "staggerFadeIn", 0.3),
                    }}
                    onClick={() => setActiveTask(task.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0" style={{
                        background: task.type === "user_defined" ? "var(--purple)" : "var(--bg-secondary)",
                        color: task.type === "user_defined" ? "#fff" : "var(--text-secondary)",
                      }}>{i + 1}</span>
                      <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>{task.content}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditTarget(task); }}
                        className="shrink-0 opacity-0 group-hover:opacity-100 duration-200 hover:opacity-100 text-[11px] px-1.5 py-0.5 rounded font-medium"
                        style={{ color: "var(--blue)", border: "1px solid transparent" }}
                        aria-label="编辑任务"
                        title="编辑任务"
                      >编辑</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id, task.content); }}
                        className="shrink-0 opacity-0 group-hover:opacity-100 duration-200 hover:opacity-100 text-[11px] px-1.5 py-0.5 rounded font-medium"
                        style={{ color: "var(--red)", border: "1px solid transparent" }}
                        aria-label="删除任务"
                        title="删除任务"
                      >移除</button>
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
            {runningTask && (
              <div className="border-t px-2 py-2" style={{ borderColor: "var(--border)" }}>
                <div className="px-2 py-1.5 rounded text-xs" style={{ background: "rgba(77, 107, 254, 0.1)", border: "1px solid var(--blue)" }}>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[10px] animate-pulse" style={{ color: "var(--blue)" }}>●</span>
                    <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>{runningTask.content}</span>
                  </div>
                  <div className="mt-0.5 flex gap-2 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--blue)" }}>工作中</span>
                    {runningElapsed && <span>{runningElapsed}</span>}
                    <span>{runningTask.type === "user_defined" ? "用户" : "AI"}</span>
                    {runningTask.startedAt && <span>{new Date(runningTask.startedAt).toLocaleTimeString()}</span>}
                  </div>
                </div>
                {runId && (
                  <div className="mt-1.5 px-1">
                    <TaskComments runId={runId} taskId={runningTask.id} />
                  </div>
                )}
              </div>
            )}
            {/* Completed tasks */}
            {completedTasks.length > 0 && (
              <div className="border-t px-2 py-2" style={{ borderColor: "var(--border)", maxHeight: "200px", overflowY: "auto" }}>
                <h4 className="text-xs font-bold mb-1" style={{ color: "var(--green)" }}>已完成 ({completedTasks.length})</h4>
                <div className="space-y-1">
                  {completedTasks.map((t) => (
                    <div key={t.id} className="px-2 py-1.5 rounded text-xs" style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.15)" }}>
                      <div className="flex items-start gap-2">
                        <span className="shrink-0 text-[10px] mt-0.5" style={{ color: "var(--green)" }}>✓</span>
                        <span className="flex-1 whitespace-pre-wrap break-words" style={{ color: "var(--text-primary)" }}>{t.content}</span>
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
              <div className="border-t px-2 py-2" style={{ borderColor: "var(--border)", maxHeight: "200px", overflowY: "auto" }}>
                <h4 className="text-xs font-bold mb-1" style={{ color: "var(--red)" }}>出错了 ({failedTasks.length})</h4>
                <div className="space-y-1">
                  {failedTasks.map((t) => (
                    <div key={t.id} className="px-2 py-1.5 rounded text-xs" style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>{t.content}</span>
                        <div className="flex gap-1">
                          <button onClick={() => handleRetry(t.id)} className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: "var(--blue)", color: "#fff" }}>再试一次</button>
                          <button onClick={() => handleDeleteTask(t.id, t.content)} className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: "var(--red)", color: "#fff" }}>移除</button>
                        </div>
                      </div>
                      {t.errorMessage && <p className="mt-0.5 text-[10px] truncate" style={{ color: "var(--text-secondary)" }} title={t.errorMessage}>{t.errorMessage}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>
            {/* Add task button — always pinned at bottom */}
            <div className="shrink-0 px-3 py-3 border-t" style={{ borderColor: "var(--border)" }}>
              <button
                onClick={() => setShowAddModal(true)}
                className="w-full px-4 py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
                style={{
                  background: "var(--green)",
                  color: "#fff",
                  height: "29px",
                  boxShadow: "0 2px 8px rgba(16, 185, 129, 0.3)",
                  transition: "transform 0.15s, box-shadow 0.15s",
                }}
              >
                + 添加任务
              </button>
            </div>
          </div>
          </DashboardErrorBoundary>
          <DashboardErrorBoundary name="内容区">
          <div className="flex-1 flex flex-col min-w-0">
            {/* Tab bar with sliding indicator */}
            <div className="px-4 py-2 border-b relative flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <div className="flex">
              {(simpleMode
                ? (["activity" as const, "trace" as const, "errors" as const, "suggestions" as const, ...(run?.finalReport ? ["report" as const] : [])] as TabType[])
                : (["logs", "commits", "lessons", ...(run?.features && run.features.length > 0 ? ["features" as const] : []), "activity" as const, "trace" as const, "errors" as const, "suggestions" as const, ...(run?.finalReport ? ["report" as const] : [])] as TabType[])
              ).map((t) => (
                <button key={t} onClick={() => handleTabChange(t)} className="text-sm px-4 py-2 rounded-md transition-all" style={{
                  color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
                  background: tab === t ? "var(--bg-tertiary)" : "transparent",
                  border: tab === t ? "1px solid var(--border)" : "1px solid transparent",
                  fontWeight: tab === t ? 600 : 400,
                  cursor: "pointer",
                }} onMouseEnter={(e) => { if (tab !== t) e.currentTarget.style.background = "var(--bg-tertiary)"; }} onMouseLeave={(e) => { if (tab !== t) e.currentTarget.style.background = "transparent"; }}>
                  {{ logs: `记录 (${logs.length})`, commits: `保存 (${commits.length})`, lessons: `经验 (${lessons.length})`, features: `检查项 (${run?.features?.filter(f => f.passes).length ?? 0}/${run?.features?.length ?? 0})`, activity: "动态", trace: "追踪", errors: "错误", suggestions: "审查", report: "报告" }[t]}
                </button>
              ))}
              </div>
              <button
                onClick={() => { const next = !simpleMode; setSimpleMode(next); localStorage.setItem("ui-mode", next ? "simple" : "detailed"); }}
                className="text-xs px-3 py-1.5 rounded-md shrink-0 font-medium"
                style={{ color: "var(--text-secondary)", background: "var(--bg-tertiary)", border: "1px solid var(--border)", cursor: "pointer" }}
              >
                {simpleMode ? "详细" : "简单"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 text-xs max-md:p-2" style={{ background: simpleMode ? "var(--bg-secondary)" : "var(--bg-tertiary)", fontFamily: simpleMode ? "var(--font-sans)" : "var(--font-mono)" }}>
              {showLoading ? (
                <div className="space-y-2 p-2">
                  {Array.from({ length: 8 }, (_, i) => (
                    <Skeleton key={i} variant="text" height={16} />
                  ))}
                </div>
              ) : <>
              {/* Logs Tab */}
              {tab === "logs" && (
                logs.length === 0 && !activeTaskId ? (
                  <EmptyState
                    title="等待任务执行"
                    description="启动后日志将实时显示在这里"
                    variant="logs"
                  />
                ) : (
                  <div className="space-y-0.5">
                    <div className="mb-2">
                      <LogSearchBar logs={logs} onFilteredChange={handleFilteredLogsChange} />
                    </div>
                    {activeTaskId && (
                      <div className="mb-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                          <span className="text-blue-400 font-mono text-xs font-bold">实时输出</span>
                        </div>
                        <StreamingOutput taskId={activeTaskId} />
                      </div>
                    )}
                    {displayLogs.map((log) => (
                      <div key={log.id} className="terminal-line terminal-line-enter">
                        <span style={{ color: "var(--text-secondary)" }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>{" "}
                        <span style={{ color: levelColor(log.level) }}>[{log.level.toUpperCase()}]</span>{" "}
                        <span style={{ color: "var(--text-secondary)" }}>[{log.source}]</span>{" "}
                        <span style={{ color: "var(--text-primary)" }}>{log.message}</span>
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )
              )}

              {/* Commits Tab */}
              {tab === "commits" && (
                commits.length === 0 ? (
                  <EmptyState title="还没有保存记录" description="任务执行后会在这里记录" variant="commits" />
                ) : (
                  <div className="space-y-2">
                    {commits.map((c, i) => (
                      <div key={i} className="glass-card-sm px-3 py-2" style={{ ...staggerItemStyle(i, 50, "slideUp", 0.3) }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span style={{ color: "var(--blue)" }}>{c.hash?.substring(0, 7) || "—"}</span>
                          {c.isAiCommit && (
                            <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "rgba(16, 185, 129, 0.15)", color: "var(--green)" }}>#AI</span>
                          )}
                          <span style={{ color: "var(--text-secondary)" }}>{formatTimestamp(c.timestamp)}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words" style={{ color: "var(--text-primary)" }}>{c.message}</p>
                        {c.taskId && (
                          <p className="mt-1 text-[10px]" style={{ color: "var(--text-secondary)" }}>Task: {c.taskId.substring(0, 8)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Lessons Tab */}
              {tab === "lessons" && (
                lessons.length === 0 ? (
                  <EmptyState title="还没有经验记录" description="任务执行的经验会记录在这里" variant="lessons" />
                ) : (
                  <div className="space-y-2">
                    {lessons.map((l, i) => (
                      <div key={i} className="glass-card-sm px-3 py-2" style={{ ...staggerItemStyle(i, 50, "slideUp", 0.3) }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-1.5 py-0.5 rounded text-[10px]" style={{
                            background: l.category === "failure" ? "rgba(239, 68, 68, 0.15)" :
                              l.category === "success" ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
                            color: l.category === "failure" ? "var(--red)" :
                              l.category === "success" ? "var(--green)" : "var(--yellow)",
                          }}>{l.category}</span>
                          {l.score != null && (
                            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                              评分: {(l.score * 100).toFixed(0)}%
                            </span>
                          )}
                          <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{formatTimestamp(l.createdAt)}</span>
                        </div>
                        <p style={{ color: "var(--text-primary)" }}>{l.lesson}</p>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Features Tab */}
              {tab === "features" && (
                run?.features ? (
                  <FeatureBoard features={run.features} />
                ) : (
                  <EmptyState title="还没有检查项" description="任务执行后会自动生成" variant="logs" />
                )
              )}

              {/* Activity Tab */}
              {tab === "activity" && (
                <ActivityTimeline runId={runId ?? ""} />
              )}

              {/* Trace Tab */}
              {tab === "trace" && (
                <TraceTab runId={runId ?? ""} call={call} />
              )}

              {/* Errors Tab */}
              {tab === "errors" && (
                <ErrorStream runId={runId ?? ""} />
              )}

              {/* Review Suggestions Tab */}
              {tab === "suggestions" && (
                <ReviewSuggestions runId={runId ?? ""} />
              )}

              {/* Report Tab — rendered as markdown */}
              {tab === "report" && run?.finalReport && (
                <ReportTab content={run.finalReport} />
              )}
              </>}

            </div>
          </div>
          </DashboardErrorBoundary>
        </div>
      </div>

      {/* Right sidebar - desktop: always visible, mobile: drawer */}
      <DashboardErrorBoundary name="操作面板">
      <div
        className={`glass-sidebar w-64 border-l flex flex-col max-md:mobile-drawer max-md:mobile-drawer-right ${showPanel ? "" : "max-md:drawer-closed"}`}
        style={{ borderColor: "var(--border)", animation: "fadeIn 0.5s ease-out 0.15s both" }}
      >
        <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>操作</h3>
          <button onClick={() => setShowPanel(false)} className="md:hidden text-xs" style={{ color: "var(--text-secondary)" }} aria-label="关闭面板">✕</button>
        </div>
        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          {/* Agent Progress */}
          <AgentProgressPanel />

          {/* Start / Stop */}
          <div className="flex gap-2">
            {!isRunning ? (
              <button onClick={handleStart} disabled={actionLoading === "start"} className="flex-1 px-3 py-2 rounded text-xs font-semibold" style={{ background: actionLoading === "start" ? "var(--bg-tertiary)" : "var(--green)", color: actionLoading === "start" ? "var(--text-secondary)" : "#fff", opacity: actionLoading === "start" ? 0.7 : 1 }}>{actionLoading === "start" ? "启动中..." : run?.status === "completed" ? "▶ 继续" : "▶ 开始"}</button>
            ) : (
              <button onClick={() => setStopTarget(runId ?? "")} disabled={actionLoading === "stop"} className="flex-1 px-3 py-2 rounded text-xs font-semibold" style={{ background: actionLoading === "stop" ? "var(--bg-tertiary)" : "var(--red)", color: actionLoading === "stop" ? "var(--text-secondary)" : "#fff", opacity: actionLoading === "stop" ? 0.7 : 1 }}>{actionLoading === "stop" ? "停止中..." : "⏹ 停止"}</button>
            )}
          </div>

          {/* Budget progress */}
          {run && (isRunning || budgetUsed > 0) && (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span style={{ color: "var(--text-secondary)" }}>费用</span>
                <span style={{ color: budgetPct > 80 ? "var(--red)" : "var(--yellow)" }}>${budgetUsed.toFixed(2)} / ${budgetMax}</span>
              </div>
              <div className="w-full h-1.5 rounded" style={{ background: "var(--bg-tertiary)" }}>
                <div className="h-full rounded transition-all" style={{
                  width: `${budgetPct}%`,
                  background: budgetPct > 80 ? "var(--red)" : budgetPct > 50 ? "var(--yellow)" : "var(--green)",
                }} />
              </div>
            </div>
          )}

          {/* Timeout - hidden in simple mode unless advanced */}
          {(!simpleMode || showAdvancedPanel) && <div>
            <label className="text-xs block mb-1" style={{ color: "var(--text-secondary)" }}>
              超时: {timeoutMinutes}min
              {activeTaskId && <button
                onClick={async () => {
                  try {
                    await call("task.setTimeout", { taskId: activeTaskId, runId: run?.id, minutes: timeoutMinutes });
                  } catch (err) {
                    console.warn("Set timeout failed:", err instanceof Error ? err.message : err);
                  }
                }}
                className="ml-2 text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: "var(--blue)", color: "#fff" }}
              >应用</button>}
            </label>
            <input type="range" min="1" max="180" value={timeoutMinutes}
              onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
              aria-valuemin={1} aria-valuemax={180} aria-valuenow={timeoutMinutes}
              aria-label="任务超时时间"
              className="w-full" />
          </div>}

          {/* Stats */}
          {run && (
            <div className="pt-2 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
              <div>
                <h4 className="text-xs font-bold mb-1" style={{ color: "var(--text-secondary)" }}>概况</h4>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span style={{ color: "var(--text-secondary)" }}>已完成</span><span style={{ color: "var(--green)" }}>{run.totalTasksCompleted}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--text-secondary)" }}>费用</span><span style={{ color: "var(--yellow)" }}>${run.totalCostUsd.toFixed(4)}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--text-secondary)" }}>保存</span><span style={{ color: "var(--blue)" }}>{commits.length}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--text-secondary)" }}>经验</span><span style={{ color: "var(--red)" }}>{lessons.length}</span></div>
                </div>
              </div>

              {/* Goals */}
              <EditableList
                title="目标"
                items={run.goals}
                dotColor="var(--green)"
                onSave={(items) => call("run.update", { runId, goals: items })}
              />

              {/* Termination Conditions */}
              <EditableList
                title="完成标准"
                items={run.terminationConditions}
                dotColor="var(--yellow)"
                onSave={(items) => call("run.update", { runId, terminationConditions: items })}
              />

              {/* Online Users - advanced only */}
              {!simpleMode && (
              <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
                <PresencePanel />
              </div>
              )}

              {/* Advanced options toggle */}
              {simpleMode && (
              <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
                <button
                  onClick={() => setShowAdvancedPanel(!showAdvancedPanel)}
                  className="text-xs underline"
                  style={{ color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer" }}
                >
                  {showAdvancedPanel ? "收起高级选项" : "高级选项"}
                </button>
              </div>
              )}

              {/* Goal State Panel */}
              {run.goalStatus && run.goalStatus !== "unmet" && (
                <div className="border-t pt-3 space-y-2" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>进度</h4>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                      style={{
                        background: GOAL_STATUS_LABELS[run.goalStatus]?.bg ?? "var(--bg-secondary)",
                        color: GOAL_STATUS_LABELS[run.goalStatus]?.color ?? "var(--text-secondary)",
                      }}
                    >
                      {GOAL_STATUS_LABELS[run.goalStatus]?.label ?? run.goalStatus}
                    </span>
                  </div>

                  {(run.goalEvaluationCycles ?? 0) > 0 && (
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span style={{ color: "var(--text-secondary)" }}>评估次数</span>
                        <span>{run.goalEvaluationCycles}</span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: "var(--text-secondary)" }}>用时</span>
                        <span>{formatGoalDuration(run.goalTimeElapsedMs ?? 0)}</span>
                      </div>
                    </div>
                  )}

                  {run.goalBudgetTokens && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span style={{ color: "var(--text-secondary)" }}>AI 用量</span>
                        <span>{formatGoalTokens(run.goalTokensUsed ?? 0)} / {formatGoalTokens(run.goalBudgetTokens)}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-primary)" }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(((run.goalTokensUsed ?? 0) / run.goalBudgetTokens) * 100, 100)}%`,
                            background: (run.goalTokensUsed ?? 0) / run.goalBudgetTokens > 0.8 ? "var(--red)"
                              : (run.goalTokensUsed ?? 0) / run.goalBudgetTokens > 0.5 ? "var(--yellow)"
                              : "var(--green)",
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {run.goalLastEvalReason && (
                    <div className="text-xs p-2 rounded" style={{ background: "var(--bg-primary)", color: "var(--text-secondary)" }}>
                      {run.goalLastEvalReason}
                    </div>
                  )}

                  {run.goalEvidence && run.goalEvidence.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {run.goalEvidence.slice(-8).map((e, i) => (
                        <p key={i} className="text-xs flex items-start gap-1">
                          <span style={{ color: "var(--blue)" }}>•</span>
                          <span style={{ color: "var(--text-secondary)" }}>{e}</span>
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    {run.goalStatus === "pursuing" && (
                      <>
                        <button
                          className="text-xs px-2 py-1 rounded transition-colors"
                          style={{ background: "var(--bg-primary)", color: "var(--yellow)", border: "1px solid var(--border)" }}
                          onClick={() => call("run.pauseGoal", { runId: run.id }).catch(() => {})}
                        >暂停</button>
                        <button
                          className="text-xs px-2 py-1 rounded transition-colors"
                          style={{ background: "var(--bg-primary)", color: "var(--red)", border: "1px solid var(--border)" }}
                          onClick={() => call("run.clearGoal", { runId: run.id }).then(() => {
                            useTaskStore.getState().updateTask(run.id, { goalStatus: "unmet", goalEvidence: [], goalLastEvalReason: "" });
                          }).catch(() => {})}
                        >清除</button>
                      </>
                    )}
                    {run.goalStatus === "paused" && (
                      <>
                        <button
                          className="text-xs px-2 py-1 rounded transition-colors"
                          style={{ background: "var(--bg-primary)", color: "var(--green)", border: "1px solid var(--border)" }}
                          onClick={() => call("run.resumeGoal", { runId: run.id }).catch(() => {})}
                        >恢复</button>
                        <button
                          className="text-xs px-2 py-1 rounded transition-colors"
                          style={{ background: "var(--bg-primary)", color: "var(--red)", border: "1px solid var(--border)" }}
                          onClick={() => call("run.clearGoal", { runId: run.id }).then(() => {
                            useTaskStore.getState().updateTask(run.id, { goalStatus: "unmet", goalEvidence: [], goalLastEvalReason: "" });
                          }).catch(() => {})}
                        >清除</button>
                      </>
                    )}
                    {(run.goalStatus === "achieved" || run.goalStatus === "budget_exhausted") && (
                      <span className="text-xs" style={{ color: run.goalStatus === "achieved" ? "var(--green)" : "var(--red)" }}>
                        {run.goalStatus === "achieved" ? "已达成" : "预算已用完"}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Mobile share button */}
          {runId && (
            <div className="border-t pt-3 md:hidden" style={{ borderColor: "var(--border)" }}>
              <button
                onClick={handleShare}
                className="w-full text-xs px-3 py-2 rounded font-semibold"
                style={{ background: "var(--blue)", color: "#fff" }}
              >
                分享
              </button>
            </div>
          )}
        </div>
      </div>
      </DashboardErrorBoundary>

      {/* Mobile drawer backdrop */}
      {(showQueue || showPanel) && (
        <div
          className="fixed inset-0 md:hidden"
          style={{ background: "rgba(0,0,0,0.5)", zIndex: 49 }}
          onClick={closeDrawers}
        />
      )}

      {/* Add Task Modal */}
      <AddTaskModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={(text, priority, timeoutMinutes) => {
          handleAddTask(text, priority, timeoutMinutes);
          setShowAddModal(false);
        }}
        call={call}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除任务"
        message={`确定要删除任务「${deleteTarget?.content ?? ""}」吗？此操作不可撤销。`}
        confirmLabel="删除"
        variant="danger"
        onConfirm={confirmDeleteTask}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={stopTarget !== null}
        title="停止执行"
        message="停止执行？当前进度已保存，可随时继续。"
        confirmLabel="停止"
        variant="danger"
        onConfirm={handleStop}
        onCancel={() => setStopTarget(null)}
      />

      {/* Edit Task Modal */}
      {editTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => setEditTarget(null)}
        >
          <div
            className="p-6 w-full max-w-md"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "12px", animation: "slideUp 0.2s ease-out" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold mb-3">编辑任务</h3>
            <TaskCreateForm
              initialContent={editTarget.content}
              defaultPriority={editTarget.priority}
              defaultTimeout={editTarget.timeoutMinutes}
              submitLabel="保存"
              onCancel={() => setEditTarget(null)}
              onSubmit={async ({ content, priority, timeoutMinutes }) => {
                try {
                  await call("task.update", { runId: editTarget.runId, taskId: editTarget.id, content, priority, timeoutMinutes });
                  const qRes = await call("queue.list", { runId: editTarget.runId });
                  setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
                  toast.success("任务已更新");
                  setEditTarget(null);
                } catch (err) {
                  toast.error(`更新失败: ${err instanceof Error ? err.message : err}`);
                }
              }}
            />
          </div>
        </div>
      )}

      <SharePanel
        open={showSharePanel}
        onClose={() => setShowSharePanel(false)}
        runId={runId ?? ""}
        call={call}
      />
    </div>
    </>
  );
}

function levelColor(level: string): string {
  switch (level) {
    case "error": return "var(--red)";
    case "warn": return "var(--yellow)";
    case "info": return "var(--blue)";
    default: return "var(--text-secondary)";
  }
}

function EditableList({ title, items, dotColor, onSave }: {
  title: string;
  items: string[];
  dotColor: string;
  onSave: (items: string[]) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  const startEdit = () => { setDraft([...items]); setEditing(true); };
  const addItem = () => setDraft([...draft, ""]);
  const removeItem = (i: number) => setDraft(draft.filter((_, idx) => idx !== i));
  const updateItem = (i: number, v: string) => { const d = [...draft]; d[i] = v; setDraft(d); };

  const save = async () => {
    const filtered = draft.map((s) => s.trim()).filter(Boolean);
    if (filtered.length === 0) return;
    await onSave(filtered);
    setEditing(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>{title}</h4>
        {!editing && (
          <button
            onClick={startEdit}
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ color: "var(--text-secondary)", background: "var(--bg-tertiary)", border: "none", cursor: "pointer" }}
          >编辑</button>
        )}
      </div>
      {!editing ? (
        items.map((g, i) => (
          <p key={i} className="text-xs mb-1 flex items-start gap-1">
            <span style={{ color: dotColor }}>•</span>
            <span style={{ color: "var(--text-primary)" }}>{g}</span>
          </p>
        ))
      ) : (
        <div className="space-y-1 mb-1">
          {draft.map((item, i) => (
            <div key={i} className="flex gap-1">
              <input
                value={item}
                onChange={(e) => updateItem(i, e.target.value)}
                className="flex-1 text-xs px-1.5 py-1 rounded font-mono"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)", outline: "none" }}
              />
              <button onClick={() => removeItem(i)} className="text-xs px-1" style={{ color: "var(--red)", background: "none", border: "none", cursor: "pointer" }}>×</button>
            </div>
          ))}
          <div className="flex gap-1 mt-1">
            <button onClick={addItem} className="text-[10px] px-2 py-0.5 rounded" style={{ color: dotColor, background: "var(--bg-tertiary)", border: "none", cursor: "pointer" }}>+ 添加</button>
            <button onClick={save} className="text-[10px] px-2 py-0.5 rounded" style={{ color: "var(--green)", background: "var(--bg-tertiary)", border: "none", cursor: "pointer" }}>保存</button>
            <button onClick={() => setEditing(false)} className="text-[10px] px-2 py-0.5 rounded" style={{ color: "var(--text-secondary)", background: "var(--bg-tertiary)", border: "none", cursor: "pointer" }}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

function TraceTab({ runId, call }: { runId: string; call: (method: string, params?: Record<string, unknown>) => Promise<unknown> }) {
  const [spans, setSpans] = useState<import("@ai-workbench/shared").TraceSpan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    call("trace.list", { runId, limit: 200 })
      .then((data) => { setSpans(data as import("@ai-workbench/shared").TraceSpan[]); })
      .catch((err) => { console.warn("Failed to load traces:", err); })
      .finally(() => setLoading(false));
  }, [runId, call]);

  if (loading) return <div className="p-4"><Skeleton /></div>;
  if (spans.length === 0) return <EmptyState title="暂无 Trace 数据" description="任务执行后将显示 Agent 执行时间线" />;

  return <TraceTimeline spans={spans} />;
}

function ReportTab({ content }: { content: string }) {
  const html = useMemo(() => marked.parse(content, { async: false }) as string, [content]);

  return (
    <div
      className="markdown-body text-sm leading-relaxed"
      style={{ color: "var(--text-primary)", animation: "fadeIn 0.3s ease-out" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
