import { useParams, useNavigate } from "react-router-dom";
import { useEvolutionStore } from "../../stores/evolution-store";
import { useTaskStore } from "../../stores/task-store";
import { RobotMascot } from "../dashboard/RobotMascot";
import { useEngine } from "../../hooks/useEngine";
import { useState, useEffect } from "react";
import type { TaskDefinition } from "@ai-workbench/shared";

export function EvolutionDashboard() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { call } = useEngine();
  const { tasks } = useTaskStore();
  const run = tasks.find((t) => t.id === runId);
  const { queue, logs, isRunning, activeTaskId, setQueue, addLog, setRunning } = useEvolutionStore();
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);
  const [agentMode, setAgentMode] = useState<"single" | "multi">("single");

  useEffect(() => {
    if (runId) {
      call("queue.list", { runId }).then((res) => {
        const q = (res as { queue: TaskDefinition[] })?.queue || [];
        setQueue(q);
      }).catch(() => {});
    }
  }, [runId]);

  const handleStart = async () => {
    if (!runId) return;
    try {
      await call("task.start", { runId });
      setRunning(true);
      addLog({ id: Date.now(), timestamp: Date.now(), level: "info", source: "engine", message: "Execution started" });
    } catch (err) {
      addLog({ id: Date.now(), timestamp: Date.now(), level: "error", source: "engine", message: `Failed: ${err}` });
    }
  };

  const handlePause = async () => {
    if (!runId) return;
    await call("task.pause", { runId });
    setRunning(false);
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="px-6 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/")} className="text-xs px-2 py-1 rounded" style={{ color: "var(--text-secondary)" }}>← 返回</button>
            <h2 className="text-sm font-bold">自进化看板</h2>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{runId?.substring(0, 8)}</span>
            {run && (
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}>
                {run.workingDir.split("/").pop()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <RobotMascot mood={isRunning ? "working" : "idle"} size={32} />
            <span className="status-badge" style={{
              background: isRunning ? "rgba(88, 166, 255, 0.15)" : run?.status === "completed" ? "rgba(63, 185, 80, 0.15)" : "rgba(125, 133, 144, 0.15)",
              color: isRunning ? "var(--blue)" : run?.status === "completed" ? "var(--green)" : "var(--text-secondary)",
            }}>
              {isRunning ? "运行中" : run?.status === "completed" ? "已完成" : "已停止"}
            </span>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Task Queue */}
          <div className="w-72 border-r flex flex-col" style={{ borderColor: "var(--border)" }}>
            <div className="px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>任务队列 ({queue.length})</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {queue.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>队列为空</p>
                  {!isRunning && (
                    <button onClick={handleStart} className="mt-3 px-3 py-1.5 rounded text-xs" style={{ background: "var(--green)", color: "#0d1117" }}>
                      开始执行
                    </button>
                  )}
                </div>
              ) : (
                queue.map((task, i) => (
                  <div key={task.id} className="px-3 py-2 rounded text-xs" style={{
                    background: task.id === activeTaskId ? "rgba(88, 166, 255, 0.1)" : "var(--bg-tertiary)",
                    border: task.id === activeTaskId ? "1px solid var(--blue)" : "1px solid transparent",
                  }}>
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px]" style={{
                        background: task.type === "user_defined" ? "var(--purple)" : "var(--bg-secondary)",
                        color: task.type === "user_defined" ? "#0d1117" : "var(--text-secondary)",
                      }}>{i + 1}</span>
                      <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>{task.content}</span>
                    </div>
                    <div className="mt-1 flex gap-2" style={{ color: "var(--text-secondary)" }}>
                      <span>{task.type === "user_defined" ? "用户" : "智能"}</span>
                      <span>P{task.priority}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Log Stream */}
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>执行日志</h3>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{logs.length} 条</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1" style={{ background: "#010409" }}>
              {logs.length === 0 ? (
                <div className="text-center py-8">
                  <p style={{ color: "var(--text-secondary)" }}>等待任务执行...</p>
                  <span className="cursor-blink" />
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="terminal-line">
                    <span style={{ color: "var(--text-secondary)" }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>{" "}
                    <span style={{
                      color: log.level === "error" ? "var(--red)" : log.level === "warn" ? "var(--yellow)" : log.level === "info" ? "var(--blue)" : "var(--text-secondary)",
                    }}>[{log.level.toUpperCase()}]</span>{" "}
                    <span style={{ color: "var(--text-secondary)" }}>[{log.source}]</span>{" "}
                    <span style={{ color: "var(--text-primary)" }}>{log.message}</span>
                  </div>
                ))
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
        <div className="p-4 space-y-4">
          {/* Start/Pause */}
          <div className="flex gap-2">
            {!isRunning ? (
              <button onClick={handleStart} className="flex-1 px-3 py-2 rounded text-xs font-semibold" style={{ background: "var(--green)", color: "#0d1117" }}>
                ▶ 开始
              </button>
            ) : (
              <button onClick={handlePause} className="flex-1 px-3 py-2 rounded text-xs font-semibold" style={{ background: "var(--yellow)", color: "#0d1117" }}>
                ⏸ 暂停
              </button>
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
              <button onClick={() => setAgentMode("single")} className="flex-1 px-2 py-1.5 rounded text-xs" style={{
                background: agentMode === "single" ? "var(--blue)" : "var(--bg-tertiary)",
                color: agentMode === "single" ? "#0d1117" : "var(--text-secondary)",
              }}>单 Agent</button>
              <button onClick={() => setAgentMode("multi")} className="flex-1 px-2 py-1.5 rounded text-xs" style={{
                background: agentMode === "multi" ? "var(--blue)" : "var(--bg-tertiary)",
                color: agentMode === "multi" ? "#0d1117" : "var(--text-secondary)",
              }}>多 Agent</button>
            </div>
          </div>

          {/* Stats */}
          {run && (
            <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <h4 className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>运行统计</h4>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span style={{ color: "var(--text-secondary)" }}>已完成</span>
                  <span style={{ color: "var(--green)" }}>{run.totalTasksCompleted}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--text-secondary)" }}>花费</span>
                  <span style={{ color: "var(--yellow)" }}>${run.totalCostUsd.toFixed(4)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Goals */}
          {run && (
            <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <h4 className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>目标</h4>
              {run.goals.map((g, i) => (
                <p key={i} className="text-xs mb-1" style={{ color: "var(--green)" }}>• {g}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
