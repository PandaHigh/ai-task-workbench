import { useEffect } from "react";
import { engineClient } from "../lib/engine-client";
import { useTaskStore } from "../stores/task-store";
import { useEvolutionStore } from "../stores/evolution-store";
import { useApprovalStore } from "../stores/approval-store";
import { useChatStore } from "../stores/chat-store";
import { useWorkflowStore } from "../stores/workflow-store";
import type { ExecutionRun, TaskDefinition, GoalStatus, ApprovalRequest, CheckpointType, ApprovalStatus, AgentProgress } from "@ai-workbench/shared";

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
          const { addActiveTask, removeActiveTask } = useEvolutionStore.getState();
          if (status === "running") {
            addActiveTask(taskId);
          } else if (["completed", "failed", "reverted", "cancelled"].includes(status)) {
            removeActiveTask(taskId);
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
        case "chat.stream": {
          const { sessionId, type, content, toolName, success, resultPreview } = params as {
            sessionId: string;
            type: string;
            content?: string;
            toolName?: string;
            success?: boolean;
            resultPreview?: string;
          };
          const chatStore = useChatStore.getState();
          if (chatStore.sessionId !== sessionId) break;
          if (type === "text_delta" && content) {
            chatStore.appendStreamContent(content);
          } else if (type === "tool_executing" && toolName) {
            chatStore.addToolCall({ method: toolName, status: "executing" });
          } else if (type === "tool_complete" && toolName) {
            chatStore.updateToolCall(toolName, success ? "completed" : "error", resultPreview);
          }
          break;
        }
        case "chat.complete": {
          const { sessionId } = params as { sessionId: string };
          const chatStore = useChatStore.getState();
          if (chatStore.sessionId === sessionId) {
            chatStore.finalizeAssistantMessage();
          }
          break;
        }
        case "chat.error": {
          const { sessionId, error } = params as { sessionId: string; error: string };
          const chatStore = useChatStore.getState();
          if (chatStore.sessionId === sessionId) {
            chatStore.setError(error);
          }
          break;
        }

        // ─── Router & Workflow notifications ─────────────────────────

        case "router.decision": {
          const { decision } = params as { decision: { taskId?: string; taskSummary: string; strategy: { type: string; templateName?: string }; level: string; reason: string; confidence: number; timestamp: number } };
          useWorkflowStore.getState().addRouterDecision(decision);
          break;
        }

        case "workflow.started": {
          const { executionId, definitionId, definitionName, stageCount } = params as { executionId: string; definitionId: string; definitionName: string; stageCount: number };
          const stages = Array.from({ length: stageCount }, (_, i) => ({
            stageId: `stage-${i}`,
            stageName: `阶段 ${i + 1}`,
            status: "pending" as const,
          }));
          useWorkflowStore.getState().updateWorkflowProgress({
            executionId,
            definitionId,
            definitionName,
            status: "running",
            stages,
            currentStageIndex: 0,
            totalAgents: 0,
            completedAgents: 0,
            totalCostUsd: 0,
            totalDurationMs: 0,
          });
          break;
        }

        case "workflow.phase.started":
        case "workflow.phase.completed":
        case "workflow.phase.failed": {
          const { executionId, stageId, stageName } = params as { executionId: string; stageId: string; stageName: string; durationMs?: number; costUsd?: number };
          const wfStore = useWorkflowStore.getState();
          const existing = wfStore.activeWorkflows.get(executionId);
          if (existing) {
            const stageStatus = method === "workflow.phase.failed" ? "failed" as const : method === "workflow.phase.started" ? "running" as const : "passed" as const;
            const stages = existing.stages.map((s) =>
              s.stageId === stageId ? { ...s, status: stageStatus, stageName: stageName || s.stageName, ...(method === "workflow.phase.completed" ? { durationMs: (params as { durationMs?: number }).durationMs, costUsd: (params as { costUsd?: number }).costUsd } : {}) } : s
            );
            wfStore.updateWorkflowProgress({ executionId, stages });
          }
          break;
        }

        case "workflow.agent.started": {
          const { executionId } = params as { executionId: string };
          const wfStore = useWorkflowStore.getState();
          const existing = wfStore.activeWorkflows.get(executionId);
          if (existing) {
            wfStore.updateWorkflowProgress({ executionId, totalAgents: existing.totalAgents + 1 });
          }
          break;
        }

        case "workflow.agent.completed": {
          const { executionId } = params as { executionId: string };
          const wfStore = useWorkflowStore.getState();
          const existing = wfStore.activeWorkflows.get(executionId);
          if (existing) {
            wfStore.updateWorkflowProgress({ executionId, completedAgents: existing.completedAgents + 1 });
          }
          break;
        }

        case "workflow.completed": {
          const { executionId, status, totalDurationMs, totalCostUsd, totalAgents } = params as { executionId: string; status: string; totalDurationMs: number; totalCostUsd: number; totalAgents: number };
          useWorkflowStore.getState().updateWorkflowProgress({
            executionId,
            status: status as "completed" | "failed" | "cancelled",
            totalDurationMs,
            totalCostUsd,
            totalAgents,
          });
          break;
        }

        case "workflow.error": {
          const { executionId } = params as { executionId: string; error: string };
          useWorkflowStore.getState().updateWorkflowProgress({ executionId, status: "failed" });
          break;
        }

        case "workflow.loop.iteration": {
          // Loop iterations are informational, no state update needed
          break;
        }

        case "workflow.adversarial.vote": {
          // Adversarial votes are informational
          break;
        }
      }
    });
  }, [updateTask, addLog, setRunning]);
}
