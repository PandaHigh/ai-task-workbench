import { useEffect } from "react";
import { engineClient } from "../lib/engine-client";
import { useTaskStore } from "../stores/task-store";
import { useEvolutionStore } from "../stores/evolution-store";
import type { ExecutionRun } from "@ai-workbench/shared";

export function useNotifications() {
  const updateTask = useTaskStore((s) => s.updateTask);
  const addLog = useEvolutionStore((s) => s.addLog);
  const setRunning = useEvolutionStore((s) => s.setRunning);

  useEffect(() => {
    return engineClient.onNotification((method, params) => {
      switch (method) {
        case "run.status": {
          const { runId, status } = params as { runId: string; status: string };
          updateTask(runId, { status: status as ExecutionRun["status"] });
          if (status === "running") setRunning(true);
          if (status === "completed" || status === "failed") setRunning(false);
          break;
        }
        case "task.status": {
          const { taskId, status } = params as { taskId: string; status: string };
          addLog({
            id: Date.now(),
            timestamp: Date.now(),
            level: "info",
            source: "engine",
            message: `Task ${taskId.substring(0, 6)} → ${status}`,
          });
          break;
        }
        case "task.progress": {
          const { taskId, content } = params as { taskId: string; content: string };
          addLog({
            id: Date.now(),
            timestamp: Date.now(),
            level: "info",
            source: "cc",
            message: content || `Task ${taskId.substring(0, 6)} progress`,
          });
          break;
        }
        case "task.scored": {
          const { taskId, score } = params as { taskId: string; score: { overall: number; passed: boolean } };
          addLog({
            id: Date.now(),
            timestamp: Date.now(),
            level: score.passed ? "info" : "warn",
            source: "scorer",
            message: `Task ${taskId.substring(0, 6)} scored: ${(score.overall * 100).toFixed(0)}% ${score.passed ? "PASS" : "FAIL"}`,
          });
          break;
        }
        case "git.commit": {
          const { hash, message } = params as { hash: string; message: string };
          addLog({
            id: Date.now(),
            timestamp: Date.now(),
            level: "info",
            source: "git",
            message: `Commit ${hash.substring(0, 7)}: ${message}`,
          });
          break;
        }
        case "queue.updated": {
          const { queue } = params as { queue: unknown[] };
          const { setQueue } = useEvolutionStore.getState();
          setQueue(queue as any[]);
          break;
        }
        case "log.entry": {
          const entry = params as { level: string; source: string; message: string };
          addLog({ id: Date.now(), timestamp: Date.now(), ...entry });
          break;
        }
      }
    });
  }, [updateTask, addLog, setRunning]);
}
