import type {
  TaskDefinition,
  TaskContext,
  ExecutionPlan,
  TestResult,
  ReviewResult,
  PhaseRecord,
  TaskPhase,
} from "@ai-workbench/shared";
import type { CCClient, CCTaskResult, CCMessage, CCExecutionOptions } from "../cc-integration/cc-client.js";
import { GitManager } from "../git/git-manager.js";
import { ensurePlaywrightMcpConfig } from "../lib/playwright-mcp.js";
import {
  buildPlannerPrompt,
  buildPlannerSystemPrompt,
  buildDeveloperPrompt,
  buildDeveloperSystemPrompt,
  buildTesterPrompt,
  buildTesterSystemPrompt,
  buildReviewerPrompt,
  buildReviewerSystemPrompt,
  buildFixFeedback,
} from "./pipeline-prompts.js";
import { errorToMessage } from "../lib/error-utils.js";
import { TaskError } from "../lib/error-types.js";
import { parseJsonOrThrow } from "../lib/json-extract.js";

export interface PipelineResult {
  finalOutput: string;
  sessionId: string;
  totalCostUsd: number;
  durationMs: number;
  numTurns: number;
  messages: CCMessage[];
  phases: PhaseRecord[];
  iterations: number;
  plan?: ExecutionPlan;
  testResult?: TestResult;
  reviewResult?: ReviewResult;
}

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

const DEFAULT_PIPELINE_CONFIG = {
  maxFixIterations: 3,
  plannerMaxTurns: 15,
  developerMaxTurns: 40,
  testerMaxTurns: 25,
  reviewerMaxTurns: 20,
  stderrCallback: undefined as ((data: string) => void) | undefined,
};

export class TaskPipeline {
  private config = { ...DEFAULT_PIPELINE_CONFIG };

  constructor(
    private ccClient: CCClient,
    private notify: NotifyFn,
    private workingDir: string,
    config?: Partial<typeof DEFAULT_PIPELINE_CONFIG>,
  ) {
    if (config) {
      Object.assign(this.config, config);
    }
  }

  async run(
    task: TaskDefinition,
    context: TaskContext,
    abortSignal?: AbortSignal,
  ): Promise<PipelineResult> {
    const allMessages: CCMessage[] = [];
    const phases: PhaseRecord[] = [];
    let totalCost = 0;
    let totalDuration = 0;
    let totalTurns = 0;
    let lastSessionId = "";

    // ─── Phase 1: Planner ─────────────────────────────────────
    this.broadcastPhase(task.id, context.workingDir, "planner", 1);

    let plan: ExecutionPlan;
    try {
      const plannerResult = await this.executeCC(
        buildPlannerPrompt(task.content, context),
        {
          workingDir: this.workingDir,
          timeoutMinutes: task.timeoutMinutes,
          maxTurns: this.config.plannerMaxTurns,
          systemPrompt: buildPlannerSystemPrompt(),
          allowedTools: ["Read", "Glob", "Grep", "Bash"],
          abortSignal,
        },
        task.id,
        allMessages,
      );

      plan = parseJsonOrThrow<ExecutionPlan>(plannerResult.result);
      lastSessionId = plannerResult.sessionId;
      totalCost += plannerResult.totalCostUsd;
      totalDuration += plannerResult.durationMs;
      totalTurns += plannerResult.numTurns;

      phases.push({
        phase: "planner",
        durationMs: plannerResult.durationMs,
        costUsd: plannerResult.totalCostUsd,
        turns: plannerResult.numTurns,
        iteration: 1,
      });
    } catch (err) {
      throw new TaskError(`Planner phase failed: ${errorToMessage(err)}`, "pipeline_failure", { phase: "planner", retryable: true, cause: err instanceof Error ? err : undefined });
    }

    // ─── Phases 2-4: Developer → Tester → Reviewer (with fix loop) ─
    let testResult: TestResult | undefined;
    let reviewResult: ReviewResult | undefined;
    let iteration = 0;
    const maxIterations = this.config.maxFixIterations;

    while (iteration < maxIterations) {
      iteration++;

      // Phase 2: Developer
      this.broadcastPhase(task.id, this.workingDir, "developer", iteration);

      const fixFeedback = iteration > 1 && reviewResult && testResult
        ? buildFixFeedback(reviewResult, testResult)
        : undefined;

      let devResult: CCTaskResult;
      try {
        devResult = await this.executeCC(
          buildDeveloperPrompt(task.content, plan, fixFeedback),
          {
            workingDir: this.workingDir,
            timeoutMinutes: task.timeoutMinutes,
            maxTurns: this.config.developerMaxTurns,
            systemPrompt: buildDeveloperSystemPrompt(),
            allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
            abortSignal,
          },
          task.id,
          allMessages,
        );
      } catch (err) {
        if (iteration < maxIterations) {
          continue;
        }
        throw new TaskError(`Developer phase failed after ${iteration} iterations: ${errorToMessage(err)}`, "pipeline_failure", { phase: "developer", retryable: true, cause: err instanceof Error ? err : undefined });
      }

      lastSessionId = devResult.sessionId;
      totalCost += devResult.totalCostUsd;
      totalDuration += devResult.durationMs;
      totalTurns += devResult.numTurns;
      phases.push({
        phase: "developer",
        durationMs: devResult.durationMs,
        costUsd: devResult.totalCostUsd,
        turns: devResult.numTurns,
        iteration,
      });

      // Get diff summary for tester and reviewer
      const diffSummary = await this.getDiffSummary();

      // Phase 3: Tester
      this.broadcastPhase(task.id, this.workingDir, "tester", iteration);

      try {
        const testerResult = await this.executeCC(
          buildTesterPrompt(plan, diffSummary),
          {
            workingDir: this.workingDir,
            timeoutMinutes: task.timeoutMinutes,
            maxTurns: this.config.testerMaxTurns,
            systemPrompt: buildTesterSystemPrompt(),
            allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
            abortSignal,
          },
          task.id,
          allMessages,
        );

        testResult = parseJsonOrThrow<TestResult>(testerResult.result);
        lastSessionId = testerResult.sessionId;
        totalCost += testerResult.totalCostUsd;
        totalDuration += testerResult.durationMs;
        totalTurns += testerResult.numTurns;
        phases.push({
          phase: "tester",
          durationMs: testerResult.durationMs,
          costUsd: testerResult.totalCostUsd,
          turns: testerResult.numTurns,
          iteration,
        });
      } catch (err) {
        testResult = {
          testsWritten: [],
          allPassed: false,
          failures: [`Test execution failed: ${errorToMessage(err)}`],
          coverage: "Testing phase failed to execute",
        };
      }

      // Phase 4: Reviewer
      this.broadcastPhase(task.id, this.workingDir, "reviewer", iteration);

      try {
        const reviewerResult = await this.executeCC(
          buildReviewerPrompt(plan, diffSummary, testResult),
          {
            workingDir: this.workingDir,
            timeoutMinutes: task.timeoutMinutes,
            maxTurns: this.config.reviewerMaxTurns,
            systemPrompt: buildReviewerSystemPrompt(),
            allowedTools: ["Read", "Bash", "Glob", "Grep"],
            abortSignal,
          },
          task.id,
          allMessages,
        );

        reviewResult = parseJsonOrThrow<ReviewResult>(reviewerResult.result);
        lastSessionId = reviewerResult.sessionId;
        totalCost += reviewerResult.totalCostUsd;
        totalDuration += reviewerResult.durationMs;
        totalTurns += reviewerResult.numTurns;
        phases.push({
          phase: "reviewer",
          durationMs: reviewerResult.durationMs,
          costUsd: reviewerResult.totalCostUsd,
          turns: reviewerResult.numTurns,
          iteration,
        });
      } catch (err) {
        reviewResult = {
          approved: false,
          score: 0,
          issues: [],
          summary: `Review phase failed: ${errorToMessage(err)}`,
        };
      }

      // Check if approved
      if (reviewResult.approved) {
        break;
      }
    }

    // Build final output
    const finalOutput = reviewResult
      ? `Pipeline completed (${iteration} iteration${iteration > 1 ? "s" : ""}). Review: ${reviewResult.summary}`
      : "Pipeline completed without review.";

    return {
      finalOutput,
      sessionId: lastSessionId,
      totalCostUsd: totalCost,
      durationMs: totalDuration,
      numTurns: totalTurns,
      messages: allMessages,
      phases,
      iterations: iteration,
      plan,
      testResult,
      reviewResult,
    };
  }

  private async executeCC(
    prompt: string,
    options: CCExecutionOptions,
    taskId: string,
    allMessages: CCMessage[],
  ): Promise<CCTaskResult> {
    // Inject stderr callback from pipeline config
    if (this.config.stderrCallback && !options.stderrCallback) {
      options = { ...options, stderrCallback: this.config.stderrCallback };
    }
    // Inject Playwright MCP config
    if (!options.mcpConfig) {
      options = { ...options, mcpConfig: ensurePlaywrightMcpConfig() };
    }
    const collectedMessages: CCMessage[] = [];
    let result: CCTaskResult | null = null;
    let streamResult = "";
    let streamSessionId = "";
    let streamCost = 0;
    let streamDuration = 0;
    let streamTurns = 0;

    const stream = this.ccClient.executeTaskStream(prompt, options);
    for await (const message of stream) {
      collectedMessages.push(message);
      allMessages.push(message);
      this.notify("task.stream", { taskId, message });

      // Emit structured progress based on current phase
      const progress = this.parsePipelineProgress(message, taskId, allMessages.length);
      if (progress) {
        this.notify("agent.progress", progress);
      }

      if (message.type === "result" && message.subtype === "success") {
        streamResult = message.result || "";
        streamSessionId = message.session_id || "";
        streamCost = message.total_cost_usd || 0;
        streamDuration = message.duration_ms || 0;
        streamTurns = message.num_turns || 0;
      }
    }

    // Collect assistant message texts for richer content extraction
    const assistantTexts = collectedMessages
      .filter((m) => m.type === "assistant")
      .map((m) => typeof m.content === "string"
        ? m.content
        : (Array.isArray(m.content) ? (m.content as Array<{text: string}>).map((c) => c.text).join("") : ""))
      .filter(Boolean);

    // Prefer the last assistant message (richest content) over the result summary
    const bestResult = assistantTexts.length > 0
      ? assistantTexts[assistantTexts.length - 1]
      : streamResult;

    if (bestResult) {
      result = {
        result: bestResult,
        sessionId: streamSessionId,
        totalCostUsd: streamCost,
        durationMs: streamDuration,
        numTurns: streamTurns,
        messages: collectedMessages,
      };
    }

    if (!result || !result.result) {
      throw new Error("CC stream completed without producing a result");
    }

    return result;
  }


  private async getDiffSummary(): Promise<string> {
    try {
      const gitManager = new GitManager({ workingDir: this.workingDir });
      const diff = await gitManager.getDiff();
      if (!diff || diff.length === 0) return "(no unstaged changes detected)";
      return diff.length > 8000 ? diff.substring(0, 8000) + "\n... (truncated)" : diff;
    } catch (err) { console.warn("[pipeline] Failed to get diff:", errorToMessage(err));
      return "(could not retrieve diff)";
    }
  }

  private broadcastPhase(taskId: string, runId: string, phase: TaskPhase, iteration: number): void {
    this.currentPhase = phase;
    this.notify("task.phase", { taskId, runId, phase, iteration });
  }

  private currentPhase: string = "planner";

  private parsePipelineProgress(
    message: CCMessage,
    taskId: string,
    messageCount: number,
  ): import("@ai-workbench/shared").AgentProgress | null {
    if (message.type !== "tool_use" && message.type !== "assistant") return null;

    const maxTurns = this.config.plannerMaxTurns + this.config.developerMaxTurns + this.config.testerMaxTurns + this.config.reviewerMaxTurns;
    const progress = Math.min(95, Math.round((messageCount / (maxTurns * 2)) * 100));
    const name = (message as { name?: string }).name ?? "";
    let phase = "处理中";
    if (name.includes("Read") || name.includes("Glob") || name.includes("Grep")) phase = "分析代码";
    else if (name.includes("Write") || name.includes("Edit")) phase = "编写代码";
    else if (name.includes("Bash")) phase = "执行命令";
    else if (message.type === "assistant") phase = "思考中";

    return {
      runId: "",
      taskId,
      role: this.currentPhase,
      progress,
      phase,
      files: [],
      message: phase,
      timestamp: Date.now(),
    };
  }
}
