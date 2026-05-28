import { CCClient, type CCTaskResult, type CCExecutionOptions } from "../cc-integration/cc-client.js";
import type { AgentRole, TaskDefinition, TaskContext } from "@ai-workbench/shared";
import type { WorktreeManager } from "../git/worktree-manager.js";

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

export class WorkerAgent {
  private ccClient: CCClient;
  private worktreePath: string | null = null;
  private branchName: string | null = null;
  private abortController: AbortController;

  constructor(
    private role: AgentRole,
    private runId: string,
    private baseWorkingDir: string,
    private worktreeManager: WorktreeManager,
    private notify: NotifyFn,
  ) {
    this.ccClient = new CCClient();
    this.abortController = new AbortController();
  }

  getRoleId(): string {
    return this.role.id;
  }

  getWorktreePath(): string | null {
    return this.worktreePath;
  }

  async execute(task: TaskDefinition, context: TaskContext): Promise<CCTaskResult> {
    // Create isolated worktree
    this.branchName = `worker-${this.role.id}-${task.id.substring(0, 6)}`;
    this.worktreePath = await this.worktreeManager.create(this.baseWorkingDir, this.branchName);

    const systemPrompt = `${this.role.systemPrompt}

## Project Context
Goals: ${context.goals.join("; ")}
Termination conditions: ${context.terminationConditions.join("; ")}
${context.lessonsLearned.length > 0 ? `Lessons learned:\n${context.lessonsLearned.map((l) => `- ${l.lesson}`).join("\n")}` : ""}
${context.lastTenCommits.length > 0 ? `Recent commits:\n${context.lastTenCommits.slice(-3).map((c) => `- ${c.message}`).join("\n")}` : ""}`;

    const options: CCExecutionOptions = {
      workingDir: this.worktreePath,
      timeoutMinutes: task.timeoutMinutes,
      maxTurns: 30,
      systemPrompt,
      abortSignal: this.abortController.signal,
      allowedTools: this.role.allowedTools,
    };

    // Stream messages from worker
    const messages: import("../cc-integration/cc-client.js").CCMessage[] = [];
    let result: import("../cc-integration/cc-client.js").CCTaskResult | null = null;
    let streamResult = "";
    let streamSessionId = "";
    let streamCost = 0;
    let streamDuration = 0;
    let streamTurns = 0;

    const stream = this.ccClient.executeTaskStream(task.content, options);
    for await (const message of stream) {
      messages.push(message);
      this.notify("task.stream", { taskId: task.id, runId: this.runId, message, agentRole: this.role.id });

      if (message.type === "result" && message.subtype === "success") {
        streamResult = message.result || "";
        streamSessionId = message.session_id || "";
        streamCost = message.total_cost_usd || 0;
        streamDuration = message.duration_ms || 0;
        streamTurns = message.num_turns || 0;
      }
    }

    if (streamResult) {
      result = {
        result: streamResult,
        sessionId: streamSessionId,
        totalCostUsd: streamCost,
        durationMs: streamDuration,
        numTurns: streamTurns,
        messages,
      };
    } else {
      // Fallback: assemble from assistant messages
      const assistantTexts = messages
        .filter((m) => m.type === "assistant")
        .map((m) => typeof m.content === "string" ? m.content : (Array.isArray(m.content) ? (m.content as Array<{text: string}>).map(c => c.text).join("") : ""))
        .filter(Boolean);
      result = {
        result: assistantTexts.length > 0 ? assistantTexts[assistantTexts.length - 1] : "",
        sessionId: streamSessionId,
        totalCostUsd: streamCost,
        durationMs: streamDuration,
        numTurns: streamTurns,
        messages,
      };
    }

    return result;
  }

  abort(): void {
    this.abortController.abort();
  }

  async cleanup(): Promise<void> {
    this.abort();
    if (this.worktreePath && this.branchName) {
      try {
        await this.worktreeManager.remove(this.baseWorkingDir, this.worktreePath, this.branchName);
      } catch (err) {
        console.warn(`[worker-agent] Cleanup failed for ${this.branchName}: ${err instanceof Error ? err.message : err}`);
      }
      this.worktreePath = null;
      this.branchName = null;
    }
  }
}
