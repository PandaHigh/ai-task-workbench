/**
 * CrewOrchestrator – orchestrates multiple agent roles in various patterns.
 *
 * Supports four modes:
 *   - fixloop   : planner once, then dev -> test -> review loop until approved
 *   - sequential: all agents run once linearly
 *   - parallel  : planner once, then dev and tester run concurrently
 *   - adaptive  : reserved for future use
 *
 * The fixloop mode produces results identical to the legacy TaskPipeline,
 * enabling a drop-in replacement.
 */

import type {
  ExecutionPlan,
  TestResult,
  ReviewResult,
  PhaseRecord,
  TaskPhase,
  TaskContext,
} from "@ai-workbench/shared";
import type { CCMessage } from "../../cc-integration/cc-client.js";
import type { AgentExecutor, AgentResult } from "./agent-executor.js";
import {
  type CrewConfig,
  type AgentRole,
  BUILT_IN_ROLES,
  DEFAULT_CREW_CONFIG,
} from "./agent-role.js";
import {
  buildPlannerPrompt,
  buildDeveloperPrompt,
  buildTesterPrompt,
  buildReviewerPrompt,
  buildFixFeedback,
} from "../pipeline-prompts.js";
import { GitManager } from "../../git/git-manager.js";
import { errorToMessage } from "../../lib/error-utils.js";
import { parseJsonOrThrow } from "../../lib/json-extract.js";

// ─── Context & Result types ─────────────────────────────────────────────────

export interface CrewContext {
  taskId: string;
  runId: string;
  taskContent: string;
  /** Shared project context (goals, commits, lessons) */
  taskContext: TaskContext;
  /** Parsed plan from the planner phase */
  plan?: ExecutionPlan;
  /** Git diff summary of code changes */
  diffSummary?: string;
  /** Test result from the tester phase */
  testResult?: TestResult;
  /** Review result from the reviewer phase */
  reviewResult?: ReviewResult;
  /** Feedback built from review issues for fix iterations */
  fixFeedback?: string;
  /** Current fix-loop iteration (1-based) */
  iteration: number;
}

/**
 * Backward-compatible with the existing PipelineResult.
 */
export interface CrewResult {
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

// ─── Notify callback ────────────────────────────────────────────────────────

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

// ─── Orchestrator ───────────────────────────────────────────────────────────

export class CrewOrchestrator {
  private config: CrewConfig;

  constructor(
    private notify: NotifyFn,
    private workingDir: string,
    config?: Partial<CrewConfig>,
  ) {
    this.config = { ...DEFAULT_CREW_CONFIG, ...config };
  }

  // ─── Public orchestration entry points ──────────────────────────────────

  /**
   * Run agents in the fixloop mode: planner once, then dev -> test -> review
   * loop until the reviewer approves or max iterations reached.
   *
   * This is the default mode and produces identical results to the legacy
   * TaskPipeline.
   */
  async runWithFixLoop(
    taskId: string,
    runId: string,
    taskContent: string,
    taskContext: TaskContext,
    agentExecutor: AgentExecutor,
    timeoutMinutes: number = 30,
    _config: Partial<CrewConfig> = {},
    abortSignal?: AbortSignal,
  ): Promise<CrewResult> {
    const allMessages: CCMessage[] = [];
    const phases: PhaseRecord[] = [];
    let totalCost = 0;
    let totalDuration = 0;
    let totalTurns = 0;
    let lastSessionId = "";

    const plannerRole = this.resolveRole("planner");
    const developerRole = this.resolveRole("developer");
    const testerRole = this.resolveRole("tester");
    const reviewerRole = this.resolveRole("reviewer");

    // ─── Phase 1: Planner ─────────────────────────────────────────────
    this.broadcastPhase(taskId, runId, "planner", 1);

    let plan: ExecutionPlan;
    try {
      const plannerResult = await agentExecutor.execute(
        plannerRole,
        buildPlannerPrompt(taskContent, taskContext),
        this.workingDir,
        { taskId, abortSignal, timeoutMinutes },
      );

      plan = parseJsonOrThrow<ExecutionPlan>(plannerResult.output);
      this.accumulate(plannerResult, allMessages, phases, "planner", 1);
      lastSessionId = plannerResult.sessionId;
      totalCost += plannerResult.totalCostUsd;
      totalDuration += plannerResult.durationMs;
      totalTurns += plannerResult.numTurns;
    } catch (err) {
      throw new Error(`Planner phase failed: ${errorToMessage(err)}`);
    }

    // ─── Phases 2-4: Developer -> Tester -> Reviewer (fix loop) ──────
    let testResult: TestResult | undefined;
    let reviewResult: ReviewResult | undefined;
    let iteration = 0;
    const maxIterations = this.config.maxFixIterations;

    while (iteration < maxIterations) {
      iteration++;

      // Phase 2: Developer
      this.broadcastPhase(taskId, runId, "developer", iteration);

      const fixFeedback =
        iteration > 1 && reviewResult && testResult
          ? buildFixFeedback(reviewResult, testResult)
          : undefined;

      let devResult: AgentResult;
      try {
        devResult = await agentExecutor.execute(
          developerRole,
          buildDeveloperPrompt(taskContent, plan, fixFeedback),
          this.workingDir,
          { taskId, abortSignal, timeoutMinutes },
        );
      } catch (err) {
        if (iteration < maxIterations) {
          continue;
        }
        throw new Error(
          `Developer phase failed after ${iteration} iterations: ${errorToMessage(err)}`,
        );
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

      // Collect messages from the developer execution
      for (const msg of devResult.messages) {
        allMessages.push(msg);
      }

      // Get diff summary for tester and reviewer
      const diffSummary = await this.getDiffSummary();

      // Phase 3: Tester
      this.broadcastPhase(taskId, runId, "tester", iteration);

      try {
        const testerResult = await agentExecutor.execute(
          testerRole,
          buildTesterPrompt(plan, diffSummary),
          this.workingDir,
          { taskId, abortSignal, timeoutMinutes },
        );

        testResult = parseJsonOrThrow<TestResult>(testerResult.output);
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

        for (const msg of testerResult.messages) {
          allMessages.push(msg);
        }
      } catch (err) {
        testResult = {
          testsWritten: [],
          allPassed: false,
          failures: [`Test execution failed: ${errorToMessage(err)}`],
          coverage: "Testing phase failed to execute",
        };
      }

      // Phase 4: Reviewer
      this.broadcastPhase(taskId, runId, "reviewer", iteration);

      try {
        const reviewerResult = await agentExecutor.execute(
          reviewerRole,
          buildReviewerPrompt(plan, diffSummary, testResult),
          this.workingDir,
          { taskId, abortSignal, timeoutMinutes },
        );

        reviewResult = parseJsonOrThrow<ReviewResult>(reviewerResult.output);
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

        for (const msg of reviewerResult.messages) {
          allMessages.push(msg);
        }
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

  /**
   * Run all agents once in linear sequence (no fix loop).
   * Each agent runs once in the order specified by config.agents.
   */
  async runSequential(
    taskId: string,
    runId: string,
    taskContent: string,
    taskContext: TaskContext,
    agentExecutor: AgentExecutor,
    timeoutMinutes: number = 30,
    _config: Partial<CrewConfig> = {},
    abortSignal?: AbortSignal,
  ): Promise<CrewResult> {
    const allMessages: CCMessage[] = [];
    const phases: PhaseRecord[] = [];
    let totalCost = 0;
    let totalDuration = 0;
    let totalTurns = 0;
    let lastSessionId = "";
    let plan: ExecutionPlan | undefined;
    let testResult: TestResult | undefined;
    let reviewResult: ReviewResult | undefined;

    const roleIds = this.config.agents;

    for (let idx = 0; idx < roleIds.length; idx++) {
      const roleId = roleIds[idx];
      const role = this.resolveRole(roleId);
      const iteration = 1;

      this.broadcastPhase(taskId, runId, roleId as TaskPhase, iteration);

      const userPrompt = this.buildUserPrompt(
        roleId,
        taskContent,
        taskContext,
        plan,
        undefined, // no diff summary on first pass for sequential
        testResult,
      );

      const result = await agentExecutor.execute(role, userPrompt, this.workingDir, {
        taskId,
        abortSignal,
        timeoutMinutes,
      });

      lastSessionId = result.sessionId;
      totalCost += result.totalCostUsd;
      totalDuration += result.durationMs;
      totalTurns += result.numTurns;

      for (const msg of result.messages) {
        allMessages.push(msg);
      }

      phases.push({
        phase: roleId as TaskPhase,
        durationMs: result.durationMs,
        costUsd: result.totalCostUsd,
        turns: result.numTurns,
        iteration,
      });

      // Parse structured output for known roles
      if (roleId === "planner") {
        plan = parseJsonOrThrow<ExecutionPlan>(result.output);
      } else if (roleId === "tester") {
        testResult = parseJsonOrThrow<TestResult>(result.output);
      } else if (roleId === "reviewer") {
        reviewResult = parseJsonOrThrow<ReviewResult>(result.output);
      }
    }

    const finalOutput = reviewResult
      ? `Sequential run completed. Review: ${reviewResult.summary}`
      : plan
        ? `Sequential run completed. Plan: ${plan.understanding}`
        : "Sequential run completed.";

    return {
      finalOutput,
      sessionId: lastSessionId,
      totalCostUsd: totalCost,
      durationMs: totalDuration,
      numTurns: totalTurns,
      messages: allMessages,
      phases,
      iterations: 1,
      plan,
      testResult,
      reviewResult,
    };
  }

  /**
   * Run planner first, then developer and tester in parallel,
   * followed by reviewer.
   */
  async runParallel(
    taskId: string,
    runId: string,
    taskContent: string,
    taskContext: TaskContext,
    agentExecutor: AgentExecutor,
    timeoutMinutes: number = 30,
    _config: Partial<CrewConfig> = {},
    abortSignal?: AbortSignal,
  ): Promise<CrewResult> {
    const allMessages: CCMessage[] = [];
    const phases: PhaseRecord[] = [];
    let totalCost = 0;
    let totalDuration = 0;
    let totalTurns = 0;
    let lastSessionId = "";

    const plannerRole = this.resolveRole("planner");
    const developerRole = this.resolveRole("developer");
    const testerRole = this.resolveRole("tester");
    const reviewerRole = this.resolveRole("reviewer");

    // ─── Phase 1: Planner ─────────────────────────────────────────────
    this.broadcastPhase(taskId, runId, "planner", 1);

    let plan: ExecutionPlan;
    try {
      const plannerResult = await agentExecutor.execute(
        plannerRole,
        buildPlannerPrompt(taskContent, taskContext),
        this.workingDir,
        { taskId, abortSignal, timeoutMinutes },
      );

      plan = parseJsonOrThrow<ExecutionPlan>(plannerResult.output);
      lastSessionId = plannerResult.sessionId;
      totalCost += plannerResult.totalCostUsd;
      totalDuration += plannerResult.durationMs;
      totalTurns += plannerResult.numTurns;

      for (const msg of plannerResult.messages) {
        allMessages.push(msg);
      }

      phases.push({
        phase: "planner",
        durationMs: plannerResult.durationMs,
        costUsd: plannerResult.totalCostUsd,
        turns: plannerResult.numTurns,
        iteration: 1,
      });
    } catch (err) {
      throw new Error(`Planner phase failed: ${errorToMessage(err)}`);
    }

    // ─── Phase 2: Developer + Tester in parallel ──────────────────────
    this.broadcastPhase(taskId, runId, "developer", 1);
    this.broadcastPhase(taskId, runId, "tester", 1);

    // Developer runs with the plan; tester runs with plan (no diff yet,
    // since dev hasn't produced changes). The tester will look at the
    // existing codebase structure.
    const [devOutcome, testOutcome] = await Promise.allSettled([
      agentExecutor.execute(
        developerRole,
        buildDeveloperPrompt(taskContent, plan),
        this.workingDir,
        { taskId, abortSignal, timeoutMinutes },
      ),
      agentExecutor.execute(
        testerRole,
        buildTesterPrompt(plan, "(parallel mode: diff not yet available)"),
        this.workingDir,
        { taskId, abortSignal, timeoutMinutes },
      ),
    ]);

    // Process developer result
    if (devOutcome.status === "fulfilled") {
      const devResult = devOutcome.value;
      lastSessionId = devResult.sessionId;
      totalCost += devResult.totalCostUsd;
      totalDuration += devResult.durationMs;
      totalTurns += devResult.numTurns;

      for (const msg of devResult.messages) {
        allMessages.push(msg);
      }

      phases.push({
        phase: "developer",
        durationMs: devResult.durationMs,
        costUsd: devResult.totalCostUsd,
        turns: devResult.numTurns,
        iteration: 1,
      });
    }

    // Process tester result
    let testResult: TestResult | undefined;
    if (testOutcome.status === "fulfilled") {
      const testerResult = testOutcome.value;
      lastSessionId = testerResult.sessionId;
      totalCost += testerResult.totalCostUsd;
      totalDuration += testerResult.durationMs;
      totalTurns += testerResult.numTurns;

      for (const msg of testerResult.messages) {
        allMessages.push(msg);
      }

      phases.push({
        phase: "tester",
        durationMs: testerResult.durationMs,
        costUsd: testerResult.totalCostUsd,
        turns: testerResult.numTurns,
        iteration: 1,
      });

      try {
        testResult = parseJsonOrThrow<TestResult>(testerResult.output);
      } catch {
        testResult = {
          testsWritten: [],
          allPassed: false,
          failures: ["Failed to parse tester output"],
          coverage: "Parse error",
        };
      }
    } else {
      testResult = {
        testsWritten: [],
        allPassed: false,
        failures: [`Tester execution failed: ${errorToMessage(testOutcome.reason)}`],
        coverage: "Testing phase failed to execute",
      };
    }

    // If developer failed, abort before reviewer
    if (devOutcome.status === "rejected") {
      throw new Error(
        `Developer phase failed in parallel mode: ${errorToMessage(devOutcome.reason)}`,
      );
    }

    // Get diff after developer completes
    const diffSummary = await this.getDiffSummary();

    // ─── Phase 3: Reviewer ────────────────────────────────────────────
    this.broadcastPhase(taskId, runId, "reviewer", 1);

    let reviewResult: ReviewResult | undefined;
    try {
      const reviewerResult = await agentExecutor.execute(
        reviewerRole,
        buildReviewerPrompt(plan, diffSummary, testResult),
        this.workingDir,
        { taskId, abortSignal, timeoutMinutes },
      );

      reviewResult = parseJsonOrThrow<ReviewResult>(reviewerResult.output);
      lastSessionId = reviewerResult.sessionId;
      totalCost += reviewerResult.totalCostUsd;
      totalDuration += reviewerResult.durationMs;
      totalTurns += reviewerResult.numTurns;

      for (const msg of reviewerResult.messages) {
        allMessages.push(msg);
      }

      phases.push({
        phase: "reviewer",
        durationMs: reviewerResult.durationMs,
        costUsd: reviewerResult.totalCostUsd,
        turns: reviewerResult.numTurns,
        iteration: 1,
      });
    } catch (err) {
      reviewResult = {
        approved: false,
        score: 0,
        issues: [],
        summary: `Review phase failed: ${errorToMessage(err)}`,
      };
    }

    const finalOutput = reviewResult
      ? `Parallel run completed. Review: ${reviewResult.summary}`
      : "Parallel run completed without review.";

    return {
      finalOutput,
      sessionId: lastSessionId,
      totalCostUsd: totalCost,
      durationMs: totalDuration,
      numTurns: totalTurns,
      messages: allMessages,
      phases,
      iterations: 1,
      plan,
      testResult,
      reviewResult,
    };
  }

  // ─── Internal helpers ─────────────────────────────────────────────────

  private resolveRole(id: string): AgentRole {
    const role = BUILT_IN_ROLES[id];
    if (!role) {
      throw new Error(`Unknown agent role: "${id}"`);
    }
    return role;
  }

  /**
   * Build the appropriate user prompt for a role based on available context.
   * Used by runSequential where the prompt construction varies by role.
   */
  private buildUserPrompt(
    roleId: string,
    taskContent: string,
    taskContext: TaskContext,
    plan?: ExecutionPlan,
    diffSummary?: string,
    testResult?: TestResult,
  ): string {
    switch (roleId) {
      case "planner":
        return buildPlannerPrompt(taskContent, taskContext);
      case "developer":
        if (!plan) {
          throw new Error("Developer requires a plan from the planner phase");
        }
        return buildDeveloperPrompt(taskContent, plan);
      case "tester":
        if (!plan) {
          throw new Error("Tester requires a plan from the planner phase");
        }
        return buildTesterPrompt(plan, diffSummary ?? "(no diff available yet)");
      case "reviewer":
        if (!plan || !testResult) {
          throw new Error("Reviewer requires both a plan and test results");
        }
        return buildReviewerPrompt(plan, diffSummary ?? "(no diff available)", testResult);
      default:
        return taskContent;
    }
  }

  /**
   * Helper to accumulate agent results into shared arrays.
   */
  private accumulate(
    result: AgentResult,
    allMessages: CCMessage[],
    phases: PhaseRecord[],
    phaseName: TaskPhase,
    iteration: number,
  ): void {
    for (const msg of result.messages) {
      allMessages.push(msg);
    }
    phases.push({
      phase: phaseName,
      durationMs: result.durationMs,
      costUsd: result.totalCostUsd,
      turns: result.numTurns,
      iteration,
    });
  }

  private async getDiffSummary(): Promise<string> {
    try {
      const gitManager = new GitManager({ workingDir: this.workingDir });
      const diff = await gitManager.getDiff();
      if (!diff || diff.length === 0) return "(no unstaged changes detected)";
      return diff.length > 8000
        ? diff.substring(0, 8000) + "\n... (truncated)"
        : diff;
    } catch (err) {
      console.warn(
        "[crew-orchestrator] Failed to get diff:",
        errorToMessage(err),
      );
      return "(could not retrieve diff)";
    }
  }

  private broadcastPhase(
    taskId: string,
    runId: string,
    phase: TaskPhase,
    iteration: number,
  ): void {
    this.notify("task.phase", { taskId, runId, phase, iteration });
  }
}
