import { useEffect } from "react";
import { engineClient } from "../lib/engine-client";
import { useTaskStore } from "../stores/task-store";
import { useEvolutionStore } from "../stores/evolution-store";
import { useApprovalStore } from "../stores/approval-store";
import type { ExecutionRun, TaskDefinition, GoalStatus, ApprovalRequest, CheckpointType, ApprovalStatus, AgentProgress, DetectedError } from "@ai-workbench/shared";

export function useNotifications() {
  const updateTask = useTaskStore((s) => s.updateTask);
  const addLog = useEvolutionStore((s) => s.addLog);
  const setRunning = useEvolutionStore((s) => s.setRunning);

  useEffect(() => {
    return engineClient.onNotification((method, params) => {
      switch (method) {
        case "run.status": {
          const { runId, status, report } = params as { runId: string; status: string; report?: string };
          const updates: Partial<ExecutionRun> = { status: status as ExecutionRun["status"] };
          if (report) updates.finalReport = report;
          if (status === "completed") updates.completedAt = Date.now();
          updateTask(runId, updates);
          if (status === "running") setRunning(true);
          if (status === "completed" || status === "failed" || status === "paused" || status === "budget_exceeded") setRunning(false);
          break;
        }
        case "task.status": {
          const { taskId, status } = params as { taskId: string; status: string };
          const { setActiveTask } = useEvolutionStore.getState();
          if (status === "running") {
            setActiveTask(taskId);
          } else if (["completed", "failed", "reverted", "cancelled"].includes(status)) {
            setActiveTask(null);
          }
          addLog({
            timestamp: Date.now(),
            level: status === "failed" ? "error" : status === "reverted" ? "warn" : "info",
            source: "engine",
            message: `Task ${taskId.substring(0, 6)} → ${status}`,
          });
          break;
        }
        case "task.progress": {
          const { taskId, content } = params as { taskId: string; content: string };
          addLog({
            timestamp: Date.now(),
            level: "info",
            source: "cc",
            message: content || `Task ${taskId.substring(0, 6)} progress`,
          });
          break;
        }
        case "task.scored": {
          const { taskId, score } = params as { taskId: string; score: { overall: number; passed: boolean; reasoning?: string } };
          addLog({
            timestamp: Date.now(),
            level: score.passed ? "info" : "warn",
            source: "scorer",
            message: `Task ${taskId.substring(0, 6)} scored: ${(score.overall * 100).toFixed(0)}% ${score.passed ? "PASS" : "FAIL"}${score.reasoning ? ` — ${score.reasoning}` : ""}`,
          });
          break;
        }
        case "git.commit": {
          const { hash, message } = params as { hash: string; message: string };
          addLog({
            timestamp: Date.now(),
            level: "info",
            source: "git",
            message: `Commit ${hash.substring(0, 7)}: ${message}`,
          });
          break;
        }
        case "queue.updated": {
          const { queue } = params as { queue: TaskDefinition[] };
          const { setQueue } = useEvolutionStore.getState();
          setQueue(queue);
          break;
        }
        case "log.entry": {
          const entry = params as { level: string; source: string; message: string };
          addLog({ timestamp: Date.now(), ...entry });
          break;
        }
        case "goal.updated": {
          const { runId, goal } = params as {
            runId: string;
            goal: {
              status: string;
              tokensUsed: number;
              budgetTokens: number;
              timeElapsedMs: number;
              evaluationCycles: number;
              lastEvaluationReason: string;
              evidence: string[];
            };
          };
          updateTask(runId, {
            goalStatus: goal.status as GoalStatus,
            goalTokensUsed: goal.tokensUsed,
            goalBudgetTokens: goal.budgetTokens,
            goalTimeElapsedMs: goal.timeElapsedMs,
            goalEvaluationCycles: goal.evaluationCycles,
            goalLastEvalReason: goal.lastEvaluationReason,
            goalEvidence: goal.evidence,
          });
          break;
        }
        case "approval.requested": {
          const { approvalId, runId, taskId, checkpointType, summary, contextData } = params as {
            approvalId: string;
            runId: string;
            taskId?: string;
            checkpointType: CheckpointType;
            summary: string;
            contextData: Record<string, unknown>;
            timeoutAt?: number;
          };
          const { addApproval } = useApprovalStore.getState();
          addApproval({
            id: approvalId,
            runId,
            taskId,
            checkpointType,
            summary,
            contextData,
            status: "pending",
            createdAt: Date.now(),
            autoAction: "approve",
          } as ApprovalRequest);
          addLog({
            timestamp: Date.now(),
            level: "warn",
            source: "engine",
            message: `Approval needed: ${summary}`,
          });
          break;
        }
        case "approval.resolved": {
          const { approvalId, status } = params as { approvalId: string; status: ApprovalStatus };
          const { removeApproval } = useApprovalStore.getState();
          removeApproval(approvalId);
          addLog({
            timestamp: Date.now(),
            level: "info",
            source: "engine",
            message: `Approval ${approvalId.substring(0, 6)} resolved: ${status}`,
          });
          break;
        }
        case "task.stream": {
          const { taskId, message } = params as { taskId: string; message: { type: string; subtype?: string; content?: unknown } };
          const { appendStreamMessage } = useApprovalStore.getState();
          appendStreamMessage(taskId, message);
          break;
        }
        case "features.generated": {
          addLog({
            timestamp: Date.now(),
            level: "info",
            source: "engine",
            message: "Feature list generated",
          });
          break;
        }
        case "features.updated": {
          const { passed, total } = params as { passed: number; total: number };
          addLog({
            timestamp: Date.now(),
            level: "info",
            source: "engine",
            message: `Features: ${passed}/${total} passed`,
          });
          break;
        }
        case "presence.joined": {
          const { displayName } = params as { displayName: string };
          addLog({
            timestamp: Date.now(), level: "info", source: "engine",
            message: `${displayName} 已连接`,
          });
          break;
        }
        case "presence.left": {
          const { displayName } = params as { displayName: string };
          addLog({
            timestamp: Date.now(), level: "info", source: "engine",
            message: `${displayName} 已断开`,
          });
          break;
        }
        case "activity.created": {
          break;
        }
        case "comment.created": {
          const { userId, taskId } = params as { userId: string; taskId: string };
          addLog({
            timestamp: Date.now(), level: "info", source: "engine",
            message: `${userId} 评论了任务 ${taskId.substring(0, 6)}`,
          });
          break;
        }
        case "agent.progress": {
          const progress = params as unknown as AgentProgress;
          const { updateAgentProgress } = useEvolutionStore.getState();
          updateAgentProgress(progress.role, progress);
          break;
        }
        case "error.detected": {
          const error = params as { id?: string; message: string; severity: string; category: string; file?: string; line?: number; fixTaskId?: string; timestamp?: number };
          const { addError } = useEvolutionStore.getState();
          addError({
            id: error.id || `err-${Date.now()}`,
            message: error.message,
            severity: error.severity as "critical" | "warning" | "info",
            category: error.category as DetectedError["category"],
            file: error.file,
            line: error.line,
            fixTaskId: error.fixTaskId,
            timestamp: error.timestamp || Date.now(),
            runId: "",
          });
          addLog({
            timestamp: Date.now(),
            level: error.severity === "critical" ? "error" : "warn",
            source: "engine",
            message: `检测到错误: ${error.message.substring(0, 100)}${error.fixTaskId ? " (已创建修复任务)" : ""}`,
          });
          break;
        }
        case "review.suggestion": {
          const suggestion = params as { id?: string; summary: string; score: number; issues?: Array<{ severity: string; description: string; file?: string; line?: number; suggestion?: string }>; status?: string; timestamp?: number; runId?: string; taskId?: string };
          const { addSuggestion } = useEvolutionStore.getState();
          addSuggestion({
            id: suggestion.id || `rev-${Date.now()}`,
            summary: suggestion.summary,
            score: suggestion.score,
            issues: (suggestion.issues || []).map((i) => ({
              severity: i.severity as "critical" | "major" | "minor",
              file: i.file || "",
              line: i.line,
              description: i.description,
              suggestion: i.suggestion || "",
            })),
            status: (suggestion.status || "pending") as "pending" | "dismissed" | "fix_created",
            createdAt: suggestion.timestamp || Date.now(),
            runId: suggestion.runId || "",
            taskId: suggestion.taskId || "",
          });
          addLog({
            timestamp: Date.now(), level: "info", source: "engine",
            message: `后台审查完成: ${suggestion.summary} (评分: ${(suggestion.score * 100).toFixed(0)}%)`,
          });
          break;
        }
        case "task.autoFix": {
          const { originalError } = params as { taskId: string; originalError: string };
          addLog({
            timestamp: Date.now(), level: "info", source: "engine",
            message: `自动修复任务已创建: ${originalError}`,
          });
          break;
        }
      }
    });
  }, [updateTask, addLog, setRunning]);
}
