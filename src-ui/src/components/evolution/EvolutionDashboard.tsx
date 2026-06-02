import { useParams, useNavigate } from "react-router-dom";
import { useEvolutionStore } from "../../stores/evolution-store";
import { useTaskStore } from "../../stores/task-store";
import { useEngine } from "../../hooks/useEngine";
import { useState, useEffect, useRef, useCallback } from "react";
import type { TaskDefinition, GitCommit, LessonLearned, ExecutionRun } from "@ai-workbench/shared";
import { EmptyState } from "../common/EmptyState";
import { Skeleton } from "../common/Skeleton";
import { useToast } from "../common/Toast";
import { formatDuration, formatTimestamp } from "../../lib/utils";
import { pageEnterStyle, staggerItemStyle } from "../../hooks/useAnimations";
import { ApprovalPanel } from "./ApprovalPanel";
import { AgentProgressPanel } from "./AgentProgressPanel";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { GitRemotePanel } from "../settings/GitRemotePanel";
import { DashboardErrorBoundary } from "./DashboardErrorBoundary";
import { AddTaskModal } from "./AddTaskModal";
import { useElapsedTimer } from "../../hooks/useElapsedTimer";
import { SharePanel } from "../share/SharePanel";
import { TaskCreateForm } from "../common/TaskCreateForm";
import { RunHeader } from "./RunHeader";
import { TaskQueue } from "./TaskQueue";
import { GoalPanel } from "./GoalPanel";
import { LogPanel } from "./LogPanel";
import { ReportTab } from "./ReportTab";

type TabType = "logs" | "commits" | "lessons" | "report";

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

  const [tab, setTab] = useState<TabType>("logs");
  const [simpleMode, setSimpleMode] = useState(() => localStorage.getItem("ui-mode") !== "detailed");
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);
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
  const toast = useToast();

  const handleShare = () => setShowSharePanel(true);

  // Load data on mount -- only reset when runId changes
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
      } catch (err) { console.warn("[poll] refresh logs failed:", err); }

      try {
        const allTasks = (await call("run.tasks", { runId })) as TaskDefinition[];
        if (cancelled) return;
        setFailedTasks(allTasks.filter((t) => t.status === "failed" || t.status === "reverted"));
        setCompletedTasks(allTasks.filter((t) => t.status === "completed"));
        setRunningTask(allTasks.find((t) => t.status === "running") || null);
      } catch (err) { console.warn("[poll] refresh tasks failed:", err); }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [runId, connected]);

  // Periodically refresh all tasks, queue, and run data while running
  useEffect(() => {
    if (!runId || !connected) return;
    const POLL_INTERVAL = connected ? 15_000 : 30_000;
    const interval = setInterval(async () => {
      // Skip polling if run is in a terminal state
      const currentRun = fetchedRun || useTaskStore.getState().tasks.find((t) => t.id === runId) as ExecutionRun | undefined;
      if (currentRun?.status === "completed" || currentRun?.status === "failed" || currentRun?.status === "idle") return;
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
        try { setCommits((await call("run.commits", { runId })) as GitCommit[]); } catch (err) { console.warn("[poll] refresh commits failed:", err); }
        try { setLessons((await call("run.lessons", { runId })) as LessonLearned[]); } catch (err) { console.warn("[poll] refresh lessons failed:", err); }
      } catch (err) { console.warn("[poll] refresh failed:", err); }
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [runId, call, connected]);

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

  const allTabs: TabType[] = simpleMode
    ? (["logs" as const, ...(run?.finalReport ? ["report" as const] : [])] as TabType[])
    : (["logs" as const, "commits" as const, "lessons" as const, ...(run?.finalReport ? ["report" as const] : [])] as TabType[]);

  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    const idx = allTabs.indexOf(tab);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = allTabs[(idx + 1) % allTabs.length];
      handleTabChange(next);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = allTabs[(idx - 1 + allTabs.length) % allTabs.length];
      handleTabChange(prev);
    } else if (e.key === "Home") {
      e.preventDefault();
      handleTabChange(allTabs[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      handleTabChange(allTabs[allTabs.length - 1]);
    }
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

  const handleAddTask = async (text: string, priority: number, timeoutMinutes?: number, extra?: { dependsOn?: string[]; condition?: string }) => {
    if (!runId || !text.trim()) return;
    try {
      await call("task.create", { runId, content: text.trim(), type: "user_defined", priority, timeoutMinutes, ...extra });
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

  const elapsed = run?.startedAt ? formatDuration((run.completedAt || Date.now()) - run.startedAt) : "--";
  const runningElapsed = useElapsedTimer(runningTask?.startedAt);

  return (
    <>
    <ApprovalPanel />
    <div className="flex-1 flex overflow-hidden" style={pageEnterStyle()}>
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <RunHeader
          runId={runId}
          run={run}
          elapsed={elapsed}
          isRunning={isRunning}
          onBack={() => { reset(); navigate("/"); }}
          onShare={handleShare}
          onShowQueue={() => { setShowQueue(true); setShowPanel(false); }}
          onShowPanel={() => { setShowPanel(true); setShowQueue(false); }}
        />

        <div className="flex-1 flex overflow-hidden">
          {/* Task Queue - desktop: always visible sidebar, mobile: drawer */}
          <DashboardErrorBoundary name="任务队列">
            <TaskQueue
              queue={queue}
              activeTaskId={activeTaskId}
              runningTask={runningTask}
              completedTasks={completedTasks}
              failedTasks={failedTasks}
              runningElapsed={runningElapsed}
              simpleMode={simpleMode}
              showLoading={showLoading}
              isRunning={isRunning}
              runId={runId}
              showQueue={showQueue}
              runStatus={run?.status}
              onStart={handleStart}
              onSetActiveTask={setActiveTask}
              onMoveTask={moveTask}
              onDeleteTask={handleDeleteTask}
              onEditTask={setEditTarget}
              onRetry={handleRetry}
              onShowAddModal={() => setShowAddModal(true)}
              onCloseQueue={() => setShowQueue(false)}
            />
          </DashboardErrorBoundary>

          <DashboardErrorBoundary name="内容区">
          <div className="flex-1 flex flex-col min-w-0">
            {/* Tab bar with sliding indicator */}
            <div className="px-4 py-2 border-b relative flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <div className="flex" role="tablist" onKeyDown={handleTabKeyDown}>
              {allTabs.map((t) => (
                <button key={t} onClick={() => handleTabChange(t)} role="tab" aria-selected={tab === t} className="text-sm px-4 py-2 rounded-md transition-all" style={{
                  color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
                  background: tab === t ? "var(--bg-tertiary)" : "transparent",
                  border: tab === t ? "1px solid var(--border)" : "1px solid transparent",
                  fontWeight: tab === t ? 600 : 400,
                  cursor: "pointer",
                }} onMouseEnter={(e) => { if (tab !== t) e.currentTarget.style.background = "var(--bg-tertiary)"; }} onMouseLeave={(e) => { if (tab !== t) e.currentTarget.style.background = "transparent"; }}>
                  {{ logs: `记录 (${logs.length})`, commits: `保存 (${commits.length})`, lessons: `经验 (${lessons.length})`, report: "报告" }[t]}
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
                <LogPanel logs={logs} activeTaskId={activeTaskId} />
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
                          <span style={{ color: "var(--blue)" }}>{c.hash?.substring(0, 7) || "--"}</span>
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

              {/* Report Tab -- rendered as markdown */}
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
        className={`glass-sidebar w-80 border-l flex flex-col max-md:mobile-drawer max-md:mobile-drawer-right ${showPanel ? "" : "max-md:drawer-closed"}`}
        style={{ borderColor: "var(--border)", animation: "fadeIn 0.5s ease-out 0.15s both" }}
      >
        <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>操作</h3>
          <button onClick={() => setShowPanel(false)} className="md:hidden text-xs" style={{ color: "var(--text-secondary)" }} aria-label="关闭面板">&#10005;</button>
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
                  <div className="flex justify-between"><span style={{ color: "var(--text-secondary)" }}>保存</span><span style={{ color: "var(--blue)" }}>{commits.length}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--text-secondary)" }}>经验</span><span style={{ color: "var(--red)" }}>{lessons.length}</span></div>
	                  <div className="flex justify-between"><span style={{ color: "var(--text-secondary)" }}>费用</span><span style={{ color: "var(--text-primary)" }}>${(run.totalCostUsd ?? 0).toFixed(2)}</span></div>
                </div>
              </div>

              {/* Goals & Termination Conditions */}
              <GoalPanel
                run={run}
                simpleMode={simpleMode}
                showAdvancedPanel={showAdvancedPanel}
                onToggleAdvanced={() => setShowAdvancedPanel(!showAdvancedPanel)}
                onSaveGoals={(items) => call("run.update", { runId, goals: items })}
                onSaveTerminationConditions={(items) => call("run.update", { runId, terminationConditions: items })}
                onClearGoal={(id) => call("run.clearGoal", { runId: id }).then(() => {
                  useTaskStore.getState().updateTask(id, { goalStatus: "unmet", goalEvidence: [], goalLastEvalReason: "" });
                }).catch((err) => { console.warn("[EvolutionDashboard] clearGoal failed:", err instanceof Error ? err.message : err); })}
                onPauseGoal={(id) => call("run.pauseGoal", { runId: id }).catch((err) => { console.warn("[EvolutionDashboard] pauseGoal failed:", err instanceof Error ? err.message : err); })}
                onResumeGoal={(id) => call("run.resumeGoal", { runId: id }).catch((err) => { console.warn("[EvolutionDashboard] resumeGoal failed:", err instanceof Error ? err.message : err); })}
              />
            </div>
          )}

          {/* Git Remote Operations (collapsed by default) */}
          {run && showAdvancedPanel && (
            <details className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <summary className="text-[10px] cursor-pointer select-none" style={{ color: "var(--text-muted)" }}>Git 远程操作</summary>
              <div className="mt-2">
                <GitRemotePanel workingDir={run.workingDir} />
              </div>
            </details>
          )}

          {/* Task Intervention & Snapshot */}
          {isRunning && activeTaskId && (
            <div className="pt-2 border-t space-y-2" style={{ borderColor: "var(--border)" }}>
              <h4 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>任务干预</h4>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={async () => {
                  try { await call("task.intervene", { runId, taskId: activeTaskId, action: "pause" }); toast.success("已暂停任务"); }
                  catch (err) { toast.error(`操作失败: ${err instanceof Error ? err.message : err}`); }
                }} className="px-2 py-1 rounded text-[10px]" style={{ background: "var(--yellow)", color: "#fff" }}>暂停</button>
                <button onClick={async () => {
                  try { await call("task.intervene", { runId, taskId: activeTaskId, action: "skip" }); toast.success("已跳过任务"); }
                  catch (err) { toast.error(`操作失败: ${err instanceof Error ? err.message : err}`); }
                }} className="px-2 py-1 rounded text-[10px]" style={{ background: "var(--text-secondary)", color: "#fff" }}>跳过</button>
                <button onClick={async () => {
                  try { await call("task.intervene", { runId, taskId: activeTaskId, action: "cancel" }); toast.success("已取消任务"); }
                  catch (err) { toast.error(`操作失败: ${err instanceof Error ? err.message : err}`); }
                }} className="px-2 py-1 rounded text-[10px]" style={{ background: "var(--red)", color: "#fff" }}>取消</button>
              </div>
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
        onSubmit={(text, priority, timeoutMinutes, extra) => {
          handleAddTask(text, priority, timeoutMinutes, extra);
          setShowAddModal(false);
        }}
        call={call}
        existingTaskIds={queue.map((t) => t.id)}
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
          role="dialog"
          aria-modal="true"
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
