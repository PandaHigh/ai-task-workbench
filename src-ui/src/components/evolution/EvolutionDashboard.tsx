import { useParams, useNavigate } from "react-router-dom";
import { useEvolutionStore } from "../../stores/evolution-store";
import { useTaskStore } from "../../stores/task-store";
import { RobotMascot } from "../dashboard/RobotMascot";
import { useEngine } from "../../hooks/useEngine";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { TaskDefinition, GitCommit, LessonLearned } from "@ai-workbench/shared";
import { EmptyState } from "../common/EmptyState";
import { Skeleton } from "../common/Skeleton";
import { useToast } from "../common/Toast";
import { formatDuration, formatTimestamp } from "../../lib/utils";
import { pageEnterStyle, staggerItemStyle } from "../../hooks/useAnimations";
import { marked } from "marked";

type TabType = "logs" | "commits" | "lessons" | "report";

export function EvolutionDashboard() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { connected, call } = useEngine();
  const { tasks } = useTaskStore();
  const run = tasks.find((t) => t.id === runId);

  const {
    queue, logs, commits, lessons, isRunning, activeTaskId,
    setQueue, addLog, setCommits, setLessons, setRunning, setActiveTask, reset,
  } = useEvolutionStore();

  const [tab, setTab] = useState<TabType>("logs");
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const showLoading = loading || !connected;
  const [showQueue, setShowQueue] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [failedTasks, setFailedTasks] = useState<TaskDefinition[]>([]);
  const [completedTasks, setCompletedTasks] = useState<TaskDefinition[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // Load data on mount — wait for engine connection
  useEffect(() => {
    if (!runId || !connected) return;
    reset();
    setLoading(true);

    const load = async () => {
      try {
        const qRes = await call("queue.list", { runId });
        setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
      } catch (err) {
        console.warn("Failed to load queue:", err instanceof Error ? err.message : err);
        toast.error("加载任务队列失败");
      }

      try {
        const c = await call("run.commits", { runId });
        setCommits((c as GitCommit[]) || []);
      } catch (err) {
        console.warn("Failed to load commits:", err instanceof Error ? err.message : err);
        toast.error("加载提交记录失败");
      }

      try {
        const l = await call("run.lessons", { runId });
        setLessons((l as LessonLearned[]) || []);
      } catch (err) {
        console.warn("Failed to load lessons:", err instanceof Error ? err.message : err);
        toast.error("加载经验教训失败");
      }
      try {
        const allTasks = (await call("run.tasks", { runId })) as TaskDefinition[];
        setFailedTasks(allTasks.filter((t) => t.status === "failed" || t.status === "reverted"));
        setCompletedTasks(allTasks.filter((t) => t.status === "completed"));
      } catch { /* ignore */ }
      setLoading(false);
    };
    load();
  }, [runId, connected]);

  // Periodically refresh all tasks (completed/failed) and queue while running
  useEffect(() => {
    if (!runId || !connected) return;
    const interval = setInterval(async () => {
      try {
        const allTasks = (await call("run.tasks", { runId })) as TaskDefinition[];
        setCompletedTasks(allTasks.filter((t) => t.status === "completed"));
        setFailedTasks(allTasks.filter((t) => t.status === "failed" || t.status === "reverted"));
        const qRes = await call("queue.list", { runId });
        setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [runId, call]);

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
    try {
      await call("task.start", { runId });
      setRunning(true);
      toast.success("任务已开始执行");
    } catch (err) {
      addLog({ id: Date.now(), timestamp: Date.now(), level: "error", source: "engine", message: `启动失败: ${err}` });
      toast.error(`启动失败: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handlePause = async () => {
    if (!runId) return;
    try {
      await call("run.stop", { runId });
      setRunning(false);
      addLog({ id: Date.now(), timestamp: Date.now(), level: "info", source: "engine", message: "执行已暂停" });
      toast.info("执行已暂停");
    } catch (err) {
      console.warn("Pause failed:", err instanceof Error ? err.message : err);
      toast.error("暂停失败");
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

  const handleAddTask = async () => {
    if (!runId || !newTaskText.trim()) return;
    try {
      await call("task.create", { runId, content: newTaskText.trim(), type: "user_defined", priority: queue.length + 1 });
      setNewTaskText("");
      const qRes = await call("queue.list", { runId });
      setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
      toast.success("任务已添加到队列");
    } catch (err) { toast.error(`添加任务失败: ${err instanceof Error ? err.message : err}`); }
  };

  const handleRetry = async (taskId: string) => {
    if (!runId) return;
    try {
      await call("task.retry", { runId, taskId });
      const qRes = await call("queue.list", { runId });
      setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
      const allTasks = (await call("run.tasks", { runId })) as TaskDefinition[];
      setFailedTasks(allTasks.filter((t) => t.status === "failed" || t.status === "reverted"));
      toast.success("任务已重新入队");
    } catch (err) { toast.error(`重试失败: ${err instanceof Error ? err.message : err}`); }
  };
  const closeDrawers = () => {
    setShowQueue(false);
    setShowPanel(false);
  };

  const elapsed = run?.startedAt ? formatDuration((run.completedAt || Date.now()) - run.startedAt) : "—";
  const budgetUsed = run?.totalCostUsd ?? 0;
  const budgetMax = 50;
  const budgetPct = Math.min(100, (budgetUsed / budgetMax) * 100);

  return (
    <div className="flex-1 flex overflow-hidden" style={pageEnterStyle()}>
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div
          className="px-6 py-3 border-b flex items-center justify-between max-md:px-3"
          style={{ borderColor: "var(--border)", animation: "slideDown 0.3s ease-out" }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => { reset(); navigate("/"); }} className="text-xs px-2 py-1 rounded hover:opacity-80 shrink-0" style={{ color: "var(--text-secondary)" }} aria-label="返回">←</button>
            <h2 className="text-sm font-bold truncate">自进化看板</h2>
            <span className="text-xs hidden md:inline" style={{ color: "var(--text-secondary)" }}>{runId?.substring(0, 8)}</span>
            {run && <span className="text-xs px-2 py-0.5 rounded hidden md:inline" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}>{run.workingDir.split("/").pop()}</span>}
            <span className="text-xs hidden md:inline" style={{ color: "var(--text-secondary)" }}>{elapsed}</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Mobile drawer toggles */}
            <button onClick={() => { setShowQueue(true); setShowPanel(false); }} className="md:hidden text-xs px-2 py-1 rounded" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }} aria-label="打开任务队列">☰ 队列</button>
            <button onClick={() => { setShowPanel(true); setShowQueue(false); }} className="md:hidden text-xs px-2 py-1 rounded" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }} aria-label="打开控制面板">⚙ 面板</button>
            <RobotMascot mood={isRunning ? "working" : run?.status === "completed" ? "celebrating" : "idle"} size={32} />
            <span className="status-badge hidden md:inline" style={{
              background: isRunning ? "rgba(88, 166, 255, 0.15)" : run?.status === "completed" ? "rgba(63, 185, 80, 0.15)" : "rgba(125, 133, 144, 0.15)",
              color: isRunning ? "var(--blue)" : run?.status === "completed" ? "var(--green)" : "var(--text-secondary)",
            }}>
              {isRunning ? "运行中" : run?.status === "completed" ? "已完成" : run?.status === "failed" ? "失败" : "空闲"}
            </span>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Task Queue - desktop: always visible sidebar, mobile: drawer */}
          <div
            className={`w-72 border-r flex flex-col max-md:mobile-drawer max-md:mobile-drawer-left ${showQueue ? "" : "max-md:drawer-closed"}`}
            style={{ borderColor: "var(--border)", animation: "fadeIn 0.4s ease-out" }}
          >
            <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>任务队列 ({queue.length})</h3>
              {queue.length > 0 && (
                <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>拖拽排序</span>
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
                  title="队列为空"
                  description={!isRunning && run?.status !== "completed" ? "点击开始执行任务" : undefined}
                  action={!isRunning && run?.status !== "completed" ? { label: "开始执行", onClick: handleStart } : undefined}
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
                    className="px-3 py-2 rounded text-xs cursor-grab active:cursor-grabbing"
                    style={{
                      background: task.id === activeTaskId ? "rgba(88, 166, 255, 0.1)" : dragIdx === i ? "rgba(88, 166, 255, 0.05)" : "var(--bg-tertiary)",
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
                        color: task.type === "user_defined" ? "#0d1117" : "var(--text-secondary)",
                      }}>{i + 1}</span>
                      <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>{task.content}</span>
                    </div>
                    <div className="mt-1 flex gap-2" style={{ color: "var(--text-secondary)" }}>
                      <span>{task.type === "user_defined" ? "用户" : "智能"}</span>
                      <span>P{task.priority}</span>
                      <span>{task.timeoutMinutes}min</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            {/* Completed tasks */}
            {completedTasks.length > 0 && (
              <div className="border-t px-2 py-2" style={{ borderColor: "var(--border)", maxHeight: "200px", overflowY: "auto" }}>
                <h4 className="text-[10px] font-bold mb-1" style={{ color: "var(--green)" }}>已完成 ({completedTasks.length})</h4>
                <div className="space-y-1">
                  {completedTasks.map((t) => (
                    <div key={t.id} className="px-2 py-1.5 rounded text-xs" style={{ background: "rgba(63, 185, 80, 0.08)", border: "1px solid rgba(63, 185, 80, 0.15)" }}>
                      <div className="flex items-start gap-2">
                        <span className="shrink-0 text-[10px] mt-0.5" style={{ color: "var(--green)" }}>✓</span>
                        <span className="flex-1 whitespace-pre-wrap break-words" style={{ color: "var(--text-primary)" }}>{t.content}</span>
                      </div>
                      <div className="mt-0.5 flex gap-2 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                        <span>{t.type === "user_defined" ? "用户" : "智能"}</span>
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
                <h4 className="text-[10px] font-bold mb-1" style={{ color: "var(--red)" }}>失败任务 ({failedTasks.length})</h4>
                <div className="space-y-1">
                  {failedTasks.map((t) => (
                    <div key={t.id} className="px-2 py-1.5 rounded text-xs" style={{ background: "rgba(248, 81, 73, 0.08)", border: "1px solid rgba(248, 81, 73, 0.2)" }}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>{t.content}</span>
                        <button onClick={() => handleRetry(t.id)} className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: "var(--blue)", color: "#0d1117" }}>重试</button>
                      </div>
                      {t.errorMessage && <p className="mt-0.5 text-[10px] truncate" style={{ color: "var(--text-secondary)" }} title={t.errorMessage}>{t.errorMessage}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Add task button — fixed at bottom of queue panel */}
            <div className="px-3 py-3 border-t" style={{ borderColor: "var(--border)" }}>
              <button
                onClick={() => { setNewTaskText(""); setShowAddModal(true); }}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
                style={{
                  background: "var(--green)",
                  color: "#0d1117",
                  boxShadow: "0 2px 8px rgba(63, 185, 80, 0.3)",
                  transition: "transform 0.15s, box-shadow 0.15s",
                }}
              >
                + 新增任务
              </button>
            </div>
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            {/* Tab bar with sliding indicator */}
            <div className="px-4 py-2 border-b relative flex" style={{ borderColor: "var(--border)" }}>
              {(["logs", "commits", "lessons", ...(run?.finalReport ? ["report" as const] : [])] as TabType[]).map((t) => (
                <button key={t} onClick={() => handleTabChange(t)} className="text-xs px-3 py-1.5 rounded transition-colors" style={{
                  color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
                  background: tab === t ? "var(--bg-tertiary)" : "transparent",
                }}>
                  {t === "logs" ? `日志 (${logs.length})` : t === "commits" ? `Git 提交 (${commits.length})` : t === "lessons" ? `经验教训 (${lessons.length})` : "最终报告"}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs max-md:p-2" style={{ background: "#010409" }}>
              {showLoading ? (
                <div className="space-y-2 p-2">
                  {Array.from({ length: 8 }, (_, i) => (
                    <Skeleton key={i} variant="text" height={16} />
                  ))}
                </div>
              ) : <>
              {/* Logs Tab */}
              {tab === "logs" && (
                logs.length === 0 ? (
                  <EmptyState
                    title="等待任务执行"
                    description="启动后日志将实时显示在这里"
                    variant="logs"
                  />
                ) : (
                  <div className="space-y-0.5">
                    {logs.map((log) => (
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
                  <EmptyState title="暂无 Git 提交记录" description="任务执行后提交会显示在这里" variant="commits" />
                ) : (
                  <div className="space-y-2">
                    {commits.map((c, i) => (
                      <div key={i} className="glass-card-sm px-3 py-2" style={{ ...staggerItemStyle(i, 50, "slideUp", 0.3) }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span style={{ color: "var(--blue)" }}>{c.hash?.substring(0, 7) || "—"}</span>
                          {c.isAiCommit && (
                            <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "rgba(63, 185, 80, 0.15)", color: "var(--green)" }}>#AI</span>
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
                  <EmptyState title="暂无经验教训" description="任务失败和教训会记录在这里" variant="lessons" />
                ) : (
                  <div className="space-y-2">
                    {lessons.map((l, i) => (
                      <div key={i} className="glass-card-sm px-3 py-2" style={{ ...staggerItemStyle(i, 50, "slideUp", 0.3) }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-1.5 py-0.5 rounded text-[10px]" style={{
                            background: l.category === "failure" ? "rgba(248, 81, 73, 0.15)" :
                              l.category === "success" ? "rgba(63, 185, 80, 0.15)" : "rgba(210, 153, 34, 0.15)",
                            color: l.category === "failure" ? "var(--red)" :
                              l.category === "success" ? "var(--green)" : "var(--yellow)",
                          }}>{l.category}</span>
                          {l.score != null && (
                            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                              Score: {(l.score * 100).toFixed(0)}%
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

              {/* Report Tab — rendered as markdown */}
              {tab === "report" && run?.finalReport && (
                <ReportTab content={run.finalReport} />
              )}
              </>}

            </div>
          </div>
        </div>
      </div>

      {/* Right sidebar - desktop: always visible, mobile: drawer */}
      <div
        className={`glass-sidebar w-64 border-l flex flex-col max-md:mobile-drawer max-md:mobile-drawer-right ${showPanel ? "" : "max-md:drawer-closed"}`}
        style={{ borderColor: "var(--border)", animation: "fadeIn 0.5s ease-out 0.15s both" }}
      >
        <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>控制面板</h3>
          <button onClick={() => setShowPanel(false)} className="md:hidden text-xs" style={{ color: "var(--text-secondary)" }} aria-label="关闭面板">✕</button>
        </div>
        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          {/* Start / Pause */}
          <div className="flex gap-2">
            {!isRunning ? (
              <button onClick={handleStart} disabled={run?.status === "completed"} className="flex-1 px-3 py-2 rounded text-xs font-semibold disabled:opacity-40" style={{ background: "var(--green)", color: "#0d1117" }}>▶ 开始</button>
            ) : (
              <button onClick={handlePause} className="flex-1 px-3 py-2 rounded text-xs font-semibold" style={{ background: "var(--yellow)", color: "#0d1117" }}>⏸ 暂停</button>
            )}
          </div>

          {/* Budget progress */}
          {run && budgetUsed > 0 && (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span style={{ color: "var(--text-secondary)" }}>预算消耗</span>
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

          {/* Timeout */}
          <div>
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
                style={{ background: "var(--blue)", color: "#0d1117" }}
              >应用</button>}
            </label>
            <input type="range" min="1" max="180" value={timeoutMinutes}
              onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
              aria-valuemin={1} aria-valuemax={180} aria-valuenow={timeoutMinutes}
              aria-label="任务超时时间"
              className="w-full" />
          </div>

          {/* Stats */}
          {run && (
            <div className="pt-2 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
              <div>
                <h4 className="text-xs font-bold mb-1" style={{ color: "var(--text-secondary)" }}>运行统计</h4>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span style={{ color: "var(--text-secondary)" }}>已完成</span><span style={{ color: "var(--green)" }}>{run.totalTasksCompleted}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--text-secondary)" }}>花费</span><span style={{ color: "var(--yellow)" }}>${run.totalCostUsd.toFixed(4)}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--text-secondary)" }}>提交</span><span style={{ color: "var(--blue)" }}>{commits.length}</span></div>
                  <div className="flex justify-between"><span style={{ color: "var(--text-secondary)" }}>教训</span><span style={{ color: "var(--red)" }}>{lessons.length}</span></div>
                </div>
              </div>

              {/* Goals */}
              <div>
                <h4 className="text-xs font-bold mb-1" style={{ color: "var(--text-secondary)" }}>目标</h4>
                {run.goals.map((g, i) => (
                  <p key={i} className="text-xs mb-1 flex items-start gap-1">
                    <span style={{ color: "var(--green)" }}>•</span>
                    <span style={{ color: "var(--text-primary)" }}>{g}</span>
                  </p>
                ))}
              </div>

              {/* Termination Conditions */}
              <div>
                <h4 className="text-xs font-bold mb-1" style={{ color: "var(--text-secondary)" }}>终止条件</h4>
                {run.terminationConditions.map((c, i) => (
                  <p key={i} className="text-xs mb-1 flex items-start gap-1">
                    <span style={{ color: "var(--yellow)" }}>•</span>
                    <span style={{ color: "var(--text-primary)" }}>{c}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile drawer backdrop */}
      {(showQueue || showPanel) && (
        <div
          className="fixed inset-0 md:hidden"
          style={{ background: "rgba(0,0,0,0.5)", zIndex: 49 }}
          onClick={closeDrawers}
        />
      )}

      {/* Add Task Modal */}
      {showAddModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="新增任务"
          style={{
            position: "fixed", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0, 0, 0, 0.6)", backdropFilter: "blur(4px)",
            zIndex: 10000,
          }}
          onClick={() => setShowAddModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-secondary)", border: "1px solid var(--border)",
              borderRadius: "12px", padding: "24px", minWidth: "340px", maxWidth: "480px", width: "90%",
              animation: "slideUp 0.2s ease-out",
            }}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>
              新增任务
            </h3>
            <textarea
              value={newTaskText}
              onChange={(e) => setNewTaskText(e.target.value)}
              placeholder="描述你的任务..."
              rows={4}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (newTaskText.trim()) { handleAddTask(); setShowAddModal(false); }
                }
                if (e.key === "Escape") { setShowAddModal(false); }
              }}
              style={{
                width: "100%", padding: "12px 14px", borderRadius: "8px",
                background: "var(--bg-tertiary)", color: "var(--text-primary)",
                border: "2px solid var(--blue)", outline: "none",
                fontSize: "14px", lineHeight: 1.6, resize: "none",
                boxSizing: "border-box",
              }}
            />
            <p style={{ margin: "6px 0 0", fontSize: "11px", color: "var(--text-secondary)" }}>
              Ctrl+Enter 快速提交
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
              <button
                onClick={() => setShowAddModal(false)}
                style={{
                  padding: "8px 16px", background: "transparent",
                  border: "1px solid var(--border)", borderRadius: "8px",
                  color: "var(--text-secondary)", cursor: "pointer", fontSize: "13px",
                }}
              >
                取消
              </button>
              <button
                onClick={() => { if (newTaskText.trim()) { handleAddTask(); setShowAddModal(false); } }}
                disabled={!newTaskText.trim()}
                style={{
                  padding: "8px 20px", background: "var(--green)",
                  border: "none", borderRadius: "8px",
                  color: "#0d1117", cursor: "pointer", fontSize: "13px", fontWeight: 600,
                  opacity: newTaskText.trim() ? 1 : 0.4,
                }}
              >
                确认添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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
