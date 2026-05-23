import { useParams, useNavigate } from "react-router-dom";
import { useEvolutionStore } from "../../stores/evolution-store";
import { RobotMascot } from "../dashboard/RobotMascot";
import { useState } from "react";

export function EvolutionDashboard() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { queue, logs, isRunning, activeTaskId } = useEvolutionStore();
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);
  const [agentMode, setAgentMode] = useState<"single" | "multi">("single");

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="px-6 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="text-xs px-2 py-1 rounded"
              style={{ color: "var(--text-secondary)" }}
            >
              ← 返回
            </button>
            <h2 className="text-sm font-bold">自进化看板</h2>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {runId?.substring(0, 8)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <RobotMascot mood={isRunning ? "working" : "idle"} size={32} />
            <span
              className="status-badge"
              style={{
                background: isRunning ? "rgba(88, 166, 255, 0.15)" : "rgba(125, 133, 144, 0.15)",
                color: isRunning ? "var(--blue)" : "var(--text-secondary)",
              }}
            >
              {isRunning ? "运行中" : "已停止"}
            </span>
          </div>
        </div>

        {/* Queue and Logs split view */}
        <div className="flex-1 flex overflow-hidden">
          {/* Task Queue */}
          <div className="w-72 border-r flex flex-col" style={{ borderColor: "var(--border)" }}>
            <div className="px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                任务队列 ({queue.length})
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {queue.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    队列为空
                  </p>
                </div>
              ) : (
                queue.map((task, i) => (
                  <div
                    key={task.id}
                    className="px-3 py-2 rounded text-xs"
                    style={{
                      background: task.id === activeTaskId
                        ? "rgba(88, 166, 255, 0.1)"
                        : "var(--bg-tertiary)",
                      border: task.id === activeTaskId
                        ? "1px solid var(--blue)"
                        : "1px solid transparent",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-4 h-4 rounded-full flex items-center justify-center text-[10px]"
                        style={{
                          background: task.type === "user_defined" ? "var(--purple)" : "var(--bg-secondary)",
                          color: task.type === "user_defined" ? "#0d1117" : "var(--text-secondary)",
                        }}
                      >
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                        {task.content}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-2" style={{ color: "var(--text-secondary)" }}>
                      <span>{task.type === "user_defined" ? "用户" : "智能"}</span>
                      <span>P{task.priority}</span>
                      <span>{task.agentMode === "multi" ? "多" : "单"}agent</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Log Stream */}
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                执行日志
              </h3>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {logs.length} 条记录
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1" style={{ background: "#010409" }}>
              {logs.length === 0 ? (
                <div className="text-center py-8">
                  <p style={{ color: "var(--text-secondary)" }}>
                    等待任务执行...
                  </p>
                  <span className="cursor-blink" />
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="terminal-line">
                    <span style={{ color: "var(--text-secondary)" }}>
                      [{new Date(log.timestamp).toLocaleTimeString()}]
                    </span>{" "}
                    <span style={{
                      color: log.level === "error" ? "var(--red)"
                        : log.level === "warn" ? "var(--yellow)"
                        : log.level === "info" ? "var(--blue)"
                        : "var(--text-secondary)",
                    }}>
                      [{log.level.toUpperCase()}]
                    </span>{" "}
                    <span style={{ color: "var(--text-secondary)" }}>
                      [{log.source}]
                    </span>{" "}
                    <span style={{ color: "var(--text-primary)" }}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right sidebar - Controls */}
      <div className="w-64 border-l flex flex-col" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
        <div className="px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
            控制面板
          </h3>
        </div>

        <div className="p-4 space-y-4">
          {/* Timeout */}
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--text-secondary)" }}>
              超时时间: {timeoutMinutes} 分钟
            </label>
            <input
              type="range"
              min="5"
              max="180"
              value={timeoutMinutes}
              onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Agent Mode */}
          <div>
            <label className="text-xs block mb-2" style={{ color: "var(--text-secondary)" }}>
              Agent 模式
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setAgentMode("single")}
                className="flex-1 px-2 py-1.5 rounded text-xs"
                style={{
                  background: agentMode === "single" ? "var(--blue)" : "var(--bg-tertiary)",
                  color: agentMode === "single" ? "#0d1117" : "var(--text-secondary)",
                }}
              >
                单 Agent
              </button>
              <button
                onClick={() => setAgentMode("multi")}
                className="flex-1 px-2 py-1.5 rounded text-xs"
                style={{
                  background: agentMode === "multi" ? "var(--blue)" : "var(--bg-tertiary)",
                  color: agentMode === "multi" ? "#0d1117" : "var(--text-secondary)",
                }}
              >
                多 Agent
              </button>
            </div>
          </div>

          {/* Runtime Stats */}
          <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <h4 className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>
              运行统计
            </h4>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span style={{ color: "var(--text-secondary)" }}>已完成任务</span>
                <span style={{ color: "var(--green)" }}>0</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-secondary)" }}>已回滚</span>
                <span style={{ color: "var(--red)" }}>0</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-secondary)" }}>总花费</span>
                <span style={{ color: "var(--yellow)" }}>$0.00</span>
              </div>
            </div>
          </div>

          {/* Git Commits */}
          <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <h4 className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>
              Git 提交
            </h4>
            <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
              暂无提交记录
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
