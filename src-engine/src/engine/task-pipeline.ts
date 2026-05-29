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

      plan = this.parseJsonResult<ExecutionPlan>(plannerResult.result);
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
      throw new Error(`Planner phase failed: ${err instanceof Error ? err.message : err}`);
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
        throw new Error(`Developer phase failed after ${iteration} iterations: ${err instanceof Error ? err.message : err}`);
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

        testResult = this.parseJsonResult<TestResult>(testerResult.result);
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
          failures: [`Test execution failed: ${err instanceof Error ? err.message : err}`],
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

        reviewResult = this.parseJsonResult<ReviewResult>(reviewerResult.result);
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
          summary: `Review phase failed: ${err instanceof Error ? err.message : err}`,
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

  private parseJsonResult<T>(text: string): T {
    // Handle case where text is already an object stringified incorrectly
    if (typeof text !== "string") {
      throw new Error(`parseJsonResult expected string, got ${typeof text}: ${String(text).substring(0, 100)}`);
    }

    let cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();

    // Strip common non-JSON prefixes that Claude adds (e.g. "Here is the plan:\n")
    const jsonStart = Math.min(
      cleaned.indexOf("{") === -1 ? Infinity : cleaned.indexOf("{"),
      cleaned.indexOf("[") === -1 ? Infinity : cleaned.indexOf("["),
    );
    if (jsonStart > 0 && jsonStart !== Infinity) {
      cleaned = cleaned.substring(jsonStart);
    }

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // Try extracting balanced JSON
    }

    const extract = (open: string, close: string): string | null => {
      const startIdx = cleaned.indexOf(open);
      if (startIdx === -1) return null;
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = startIdx; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === open) depth++;
        if (ch === close) depth--;
        if (depth === 0) {
          const candidate = cleaned.substring(startIdx, i + 1);
          try { return JSON.parse(candidate); } catch { return null; }
        }
      }
      return null;
    };

    const extracted = extract("{", "}") || extract("[", "]");
    if (extracted) {
      return JSON.parse(extracted) as T;
    }

    throw new Error(`Failed to parse JSON from: ${text.substring(0, 200)}`);
  }

  private async getDiffSummary(): Promise<string> {
    try {
      const gitManager = new GitManager({ workingDir: this.workingDir });
      const diff = await gitManager.getDiff();
      if (!diff || diff.length === 0) return "(no unstaged changes detected)";
      return diff.length > 8000 ? diff.substring(0, 8000) + "\n... (truncated)" : diff;
    } catch {
      return "(could not retrieve diff)";
    }
  }

  private broadcastPhase(taskId: string, runId: string, phase: TaskPhase, iteration: number): void {
    this.notify("task.phase", { taskId, runId, phase, iteration });
  }
}
