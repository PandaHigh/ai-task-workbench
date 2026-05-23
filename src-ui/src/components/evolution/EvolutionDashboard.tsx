import { useParams, useNavigate } from "react-router-dom";
import { useEvolutionStore } from "../../stores/evolution-store";
import { useTaskStore } from "../../stores/task-store";
import { RobotMascot } from "../dashboard/RobotMascot";
import { useEngine } from "../../hooks/useEngine";
import { useState, useEffect, useRef, useCallback } from "react";
import type { TaskDefinition } from "@ai-workbench/shared";

type TabType = "logs" | "commits" | "lessons";

export function EvolutionDashboard() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { call } = useEngine();
  const { tasks } = useTaskStore();
  const run = tasks.find((t) => t.id === runId);

  const {
    queue, logs, commits, lessons, isRunning, activeTaskId,
    setQueue, addLog, setCommits, setLessons, setRunning, setActiveTask, reset,
  } = useEvolutionStore();

  const [tab, setTab] = useState<TabType>("logs");
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);
  const [agentMode, setAgentMode] = useState<"single" | "multi">("single");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Load data on mount
  useEffect(() => {
    if (!runId) return;
    reset();

    const load = async () => {
      try {
        const qRes = await call("queue.list", { runId });
        setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
      } catch {}

      try {
        const c = await call("run.commits", { runId });
        setCommits((c as any[]) || []);
      } catch {}

      try {
        const l = await call("run.lessons", { runId });
        setLessons((l as any[]) || []);
      } catch {}
    };
    load();
  }, [runId]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Refresh commits/lessons on tab switch
  const refreshTabData = useCallback(async (t: TabType) => {
    if (!runId) return;
    if (t === "commits") {
      try { setCommits((await call("run.commits", { runId })) as any[]); } catch {}
    } else if (t === "lessons") {
      try { setLessons((await call("run.lessons", { runId })) as any[]); } catch {}
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
    } catch (err) {
      addLog({ id: Date.now(), timestamp: Date.now(), level: "error", source: "engine", message: `启动失败: ${err}` });
    }
  };

  const handlePause = async () => {
    if (!runId) return;
    try {
      await call("run.stop", { runId });
      setRunning(false);
      addLog({ id: Date.now(), timestamp: Date.now(), level: "info", source: "engine", message: "执行已暂停" });
    } catch {}
  };

  const handleReorder = async (taskIds: string[]) => {
    if (!runId) return;
    try {
      await call("queue.reorder", { runId, taskIds });
      const qRes = await call("queue.list", { runId });
      setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
    } catch {}
  };

  const moveTask = (fromIdx: number, toIdx: number) => {
    const ids = queue.map((t) => t.id);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    handleReorder(ids);
  };

  const elapsed = run?.startedAt ? formatDuration((run.completedAt || Date.now()) - run.startedAt) : "—";

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="px-6 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <button onClick={() => { reset(); navigate("/"); }} className="text-xs px-2 py-1 rounded hover:opacity-80" style={{ color: "var(--text-secondary)" }}>← 返回</button>
            <h2 className="text-sm font-bold">自进化看板</h2>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{runId?.substring(0, 8)}</span>
            {run && <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}>{run.workingDir.split("/").pop()}</span>}
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{elapsed}</span>
          </div>
          <div className="flex items-center gap-3">
            <RobotMascot mood={isRunning ? "working" : run?.status === "completed" ? "celebrating" : "idle"} size={32} />
            <span className="status-badge" style={{
              background: isRunning ? "rgba(88, 166, 255, 0.15)" : run?.status === "completed" ? "rgba(63, 185, 80, 0.15)" : "rgba(125, 133, 144, 0.15)",
              color: isRunning ? "var(--blue)" : run?.status === "completed" ? "var(--green)" : "var(--text-secondary)",
            }}>
              {isRunning ? "运行中" : run?.status === "completed" ? "已完成" : run?.status === "failed" ? "失败" : "空闲"}
            </span>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Task Queue */}
          <div className="w-72 border-r flex flex-col" style={{ borderColor: "var(--border)" }}>
            <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>任务队列 ({queue.length})</h3>
              {queue.length > 0 && (
                <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>拖拽排序</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {queue.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>队列为空</p>
                  {!isRunning && run?.status !== "completed" && (
                    <button onClick={handleStart} className="mt-3 px-3 py-1.5 rounded text-xs" style={{ background: "var(--green)", color: "#0d1117" }}>开始执行</button>
                  )}
                </div>
              ) : (
                queue.map((task, i) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => { if (dragIdx !== null && dragIdx !== i) moveTask(dragIdx, i); setDragIdx(null); }}
                    onDragEnd={() => setDragIdx(null)}
                    className="px-3 py-2 rounded text-xs cursor-grab active:cursor-grabbing"
                    style={{
                      background: task.id === activeTaskId ? "rgba(88, 166, 255, 0.1)" : dragIdx === i ? "rgba(88, 166, 255, 0.05)" : "var(--bg-tertiary)",
                      border: task.id === activeTaskId ? "1px solid var(--blue)" : "1px solid transparent",
                      opacity: dragIdx !== null && dragIdx !== i ? 0.7 : 1,
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
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-2 border-b flex gap-3" style={{ borderColor: "var(--border)" }}>
              {(["logs", "commits", "lessons"] as TabType[]).map((t) => (
                <button key={t} onClick={() => handleTabChange(t)} className="text-xs px-2 py-1 rounded" style={{
                  background: tab === t ? "var(--bg-tertiary)" : "transparent",
                  color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
                }}>
                  {t === "logs" ? `日志 (${logs.length})` : t === "commits" ? `Git 提交 (${commits.length})` : `经验教训 (${lessons.length})`}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs" style={{ background: "#010409" }}>
              {/* Logs Tab */}
              {tab === "logs" && (
                logs.length === 0 ? (
                  <div className="text-center py-8">
                    <p style={{ color: "var(--text-secondary)" }}>等待任务执行...</p>
                    <span className="cursor-blink" />
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {logs.map((log) => (
                      <div key={log.id} className="terminal-line">
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
                  <div className="text-center py-8">
                    <p style={{ color: "var(--text-secondary)" }}>暂无 Git 提交记录</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {commits.map((c, i) => (
                      <div key={i} className="px-3 py-2 rounded" style={{ background: "var(--bg-tertiary)" }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span style={{ color: "var(--blue)" }}>{c.hash?.substring(0, 7) || "—"}</span>
                          {c.isAiCommit && (
                            <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "rgba(63, 185, 80, 0.15)", color: "var(--green)" }}>#AI</span>
                          )}
                          <span style={{ color: "var(--text-secondary)" }}>{formatTimestamp(c.timestamp)}</span>
                        </div>
                        <p className="truncate" style={{ color: "var(--text-primary)" }}>{c.message}</p>
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
                  <div className="text-center py-8">
                    <p style={{ color: "var(--text-secondary)" }}>暂无经验教训</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {lessons.map((l, i) => (
                      <div key={i} className="px-3 py-2 rounded" style={{ background: "var(--bg-tertiary)" }}>
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
            </div>
          </div>
        </div>
      </div>

      {/* Right sidebar */}
      <div className="w-64 border-l flex flex-col" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
        <div className="px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>控制面板</h3>
        </div>
        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          {/* Start / Pause / Stop */}
          <div className="flex gap-2">
            {!isRunning ? (
              <button onClick={handleStart} disabled={run?.status === "completed"} className="flex-1 px-3 py-2 rounded text-xs font-semibold disabled:opacity-40" style={{ background: "var(--green)", color: "#0d1117" }}>▶ 开始</button>
            ) : (
              <>
                <button onClick={handlePause} className="flex-1 px-3 py-2 rounded text-xs font-semibold" style={{ background: "var(--yellow)", color: "#0d1117" }}>⏸ 暂停</button>
              </>
            )}
          </div>

          {/* Timeout */}
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--text-secondary)" }}>超时: {timeoutMinutes}min</label>
            <input type="range" min="5" max="180" value={timeoutMinutes} onChange={(e) => setTimeoutMinutes(Number(e.target.value))} className="w-full" />
          </div>

          {/* Agent Mode */}
          <div>
            <label className="text-xs block mb-2" style={{ color: "var(--text-secondary)" }}>Agent 模式</label>
            <div className="flex gap-2">
              <button onClick={() => setAgentMode("single")} className="flex-1 px-2 py-1.5 rounded text-xs" style={{ background: agentMode === "single" ? "var(--blue)" : "var(--bg-tertiary)", color: agentMode === "single" ? "#0d1117" : "var(--text-secondary)" }}>单 Agent</button>
              <button onClick={() => setAgentMode("multi")} className="flex-1 px-2 py-1.5 rounded text-xs" style={{ background: agentMode === "multi" ? "var(--blue)" : "var(--bg-tertiary)", color: agentMode === "multi" ? "#0d1117" : "var(--text-secondary)" }}>多 Agent</button>
            </div>
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

              {/* Final Report */}
              {run.finalReport && (
                <div>
                  <h4 className="text-xs font-bold mb-1" style={{ color: "var(--text-secondary)" }}>最终报告</h4>
                  <div className="text-xs p-2 rounded max-h-32 overflow-y-auto" style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
                    {run.finalReport}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
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

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
