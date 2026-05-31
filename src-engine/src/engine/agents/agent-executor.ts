/**
 * AgentExecutor – wraps a single CC (Claude Code) call for one agent role.
 *
 * This is the atomic building block used by the CrewOrchestrator.
 * It reuses the streaming pattern from TaskPipeline.executeCC but is
 * generic across any AgentRole.
 */

import type { CCClient, CCMessage, CCExecutionOptions } from "../../cc-integration/cc-client.js";
import type { AgentRole } from "./agent-role.js";
import type { AgentProgress } from "@ai-workbench/shared";

// ─── Result type ────────────────────────────────────────────────────────────

export interface AgentResult {
  /** The text output produced by the agent (last assistant message or result) */
  output: string;
  /** CC session id for potential resumption */
  sessionId: string;
  /** Accumulated cost in USD */
  totalCostUsd: number;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  /** Number of conversation turns */
  numTurns: number;
  /** All messages collected during this execution */
  messages: CCMessage[];
}

// ─── Executor options ───────────────────────────────────────────────────────

export interface AgentExecutionOptions extends Partial<CCExecutionOptions> {
  /** Task id included in task.stream notifications */
  taskId?: string;
}

// ─── Notify callback ────────────────────────────────────────────────────────

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

// ─── Executor ───────────────────────────────────────────────────────────────

export class AgentExecutor {
  constructor(
    private ccClient: CCClient,
    private notify: NotifyFn,
  ) {}

  /**
   * Execute a single agent role with the given prompt.
   *
   * @param role      The agent role defining system prompt, tools, and max turns.
   * @param prompt    The user-facing prompt for this agent invocation.
   * @param workingDir Working directory for the CC subprocess.
   * @param options   Optional overrides. The role's systemPrompt, tools, and
   *                  maxTurns are used as defaults.
   * @returns AgentResult with output, cost, timing, and message details.
   */
  async execute(
    role: AgentRole,
    prompt: string,
    workingDir: string,
    options: AgentExecutionOptions = {},
  ): Promise<AgentResult> {
    const ccOptions: CCExecutionOptions = {
      workingDir,
      timeoutMinutes: options.timeoutMinutes ?? 30,
      maxTurns: options.maxTurns ?? role.maxTurns,
      systemPrompt: options.systemPrompt ?? role.systemPrompt,
      allowedTools: options.allowedTools ?? role.tools,
      abortSignal: options.abortSignal,
      sessionId: options.sessionId,
      disallowedTools: options.disallowedTools,
      jsonSchema: options.jsonSchema,
    };

    const taskId = options.taskId ?? "unknown";
    const collectedMessages: CCMessage[] = [];
    let streamResult = "";
    let streamSessionId = "";
    let streamCost = 0;
    let streamDuration = 0;
    let streamTurns = 0;

    const stream = this.ccClient.executeTaskStream(prompt, ccOptions);
    for await (const message of stream) {
      collectedMessages.push(message);
      this.notify("task.stream", { taskId, message });

      // Emit structured agent progress
      const progress = this.parseProgress(message, role, taskId, collectedMessages.length, ccOptions.maxTurns ?? role.maxTurns);
      if (progress) {
        this.notify("agent.progress", progress as unknown as Record<string, unknown>);
      }

      if (message.type === "result" && message.subtype === "success") {
        streamResult = message.result || "";
        streamSessionId = message.session_id || "";
        streamCost = message.total_cost_usd || 0;
        streamDuration = message.duration_ms || 0;
        streamTurns = message.num_turns || 0;
      }
    }

    // Collect assistant message texts for richer content extraction.
    // This mirrors the logic in TaskPipeline.executeCC.
    const assistantTexts = collectedMessages
      .filter((m) => m.type === "assistant")
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? (m.content as Array<{ text: string }>).map((c) => c.text).join("")
            : "",
      )
      .filter(Boolean);

    // Prefer the last assistant message (richest content) over the result summary
    const bestResult =
      assistantTexts.length > 0
        ? assistantTexts[assistantTexts.length - 1]
        : streamResult;

    if (!bestResult) {
      throw new Error(
        `Agent "${role.id}" completed without producing a result`,
      );
    }

    return {
      output: bestResult,
      sessionId: streamSessionId,
      totalCostUsd: streamCost,
      durationMs: streamDuration,
      numTurns: streamTurns,
      messages: collectedMessages,
    };
  }

  private parseProgress(
    message: CCMessage,
    role: AgentRole,
    taskId: string,
    messageCount: number,
    maxTurns: number,
  ): AgentProgress | null {
    // Only emit progress for tool_use and assistant messages
    if (message.type !== "tool_use" && message.type !== "assistant") return null;

    const progress = Math.min(95, Math.round((messageCount / (maxTurns * 2)) * 100));
    const files = this.extractFiles(message);
    const phase = this.inferPhase(message);

    return {
      runId: "",
      taskId,
      role: role.id,
      progress,
      phase,
      files,
      message: phase,
      timestamp: Date.now(),
    };
  }

  private extractFiles(message: CCMessage): string[] {
    const files: string[] = [];
    const content = message.content;
    if (typeof content === "string") {
      const matches = content.match(/(?:^|\s)([\w./-]+\.\w{1,10})(?:\s|$)/g);
      if (matches) files.push(...matches.map((m) => m.trim()).slice(0, 3));
    } else if (Array.isArray(content)) {
      for (const block of content as Array<{ file_path?: string; path?: string }>) {
        if (block.file_path) files.push(block.file_path);
        else if (block.path) files.push(block.path);
      }
    }
    return files.slice(0, 5);
  }

  private inferPhase(message: CCMessage): string {
    if (message.type === "assistant") return "思考中";
    const content = typeof message.content === "string" ? message.content : "";
    const name = (message as { name?: string }).name ?? "";
    if (name.includes("Read") || name.includes("Glob") || name.includes("Grep")) return "分析代码";
    if (name.includes("Write") || name.includes("Edit")) return "编写代码";
    if (name.includes("Bash")) return "执行命令";
    if (content.includes("test") || name.includes("test")) return "运行测试";
    return "处理中";
  }
}
