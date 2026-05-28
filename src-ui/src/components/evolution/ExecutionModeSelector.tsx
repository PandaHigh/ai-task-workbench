import { useEngine } from "../../hooks/useEngine";
import { useTaskStore } from "../../stores/task-store";
import type { ExecutionMode } from "@ai-workbench/shared";

interface ExecutionModeSelectorProps {
  runId: string;
  currentMode?: ExecutionMode;
  maxConcurrent?: number;
  disabled?: boolean;
}

export function ExecutionModeSelector({ runId, currentMode, maxConcurrent, disabled }: ExecutionModeSelectorProps) {
  const { call } = useEngine();
  const mode = currentMode ?? "sequential";
  const concurrent = maxConcurrent ?? 2;

  const handleModeChange = async (newMode: ExecutionMode) => {
    useTaskStore.getState().updateTask(runId, { executionMode: newMode });
    try {
      await call("run.setExecutionMode", { runId, mode: newMode });
    } catch (err) {
      useTaskStore.getState().updateTask(runId, { executionMode: mode });
      console.warn("Failed to set execution mode:", err);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleModeChange("sequential")}
          disabled={disabled}
          className="flex-1 px-3 py-1.5 rounded text-xs font-mono transition-colors disabled:opacity-40"
          style={{
            background: mode === "sequential" ? "var(--blue)" : "var(--bg-tertiary)",
            color: mode === "sequential" ? "#0d1117" : "var(--text-secondary)",
            border: mode === "sequential" ? "1px solid var(--blue)" : "1px solid var(--border)",
          }}
        >
          串行
        </button>
        <button
          onClick={() => handleModeChange("parallel")}
          disabled={disabled}
          className="flex-1 px-3 py-1.5 rounded text-xs font-mono transition-colors disabled:opacity-40"
          style={{
            background: mode === "parallel" ? "var(--blue)" : "var(--bg-tertiary)",
            color: mode === "parallel" ? "#0d1117" : "var(--text-secondary)",
            border: mode === "parallel" ? "1px solid var(--blue)" : "1px solid var(--border)",
          }}
        >
          并行
        </button>
      </div>
      {mode === "parallel" && (
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          最大并发: {concurrent} agents
        </div>
      )}
    </div>
  );
}
