import type { TaskDefinition, ExecutionRun, TaskContext, GoalEvaluation, ScoreDetails, TaskStatus } from "@ai-workbench/shared";
import { CCClient } from "../cc-integration/cc-client.js";
import { GitManager } from "../git/git-manager.js";
import { Store } from "../db/store.js";
import type { QueueManager } from "./queue-manager.js";

const DEFAULT_QUALITY_THRESHOLD = 0.6;
const DEFAULT_MAX_EVALUATION_CYCLES = 1000;
const DEFAULT_MAX_BUDGET_USD = 50;
const DEFAULT_STAGNATION_WINDOW = 5;
const DEFAULT_MAX_TURNS = 50;
const DEFAULT_MAX_AUTO_RETRIES = 3;
const CYCLE_COOLDOWN_MS = 5000;

const TRANSIENT_ERROR_PATTERNS = [
  "timed out",
  "econnreset",
  "econnrefused",
  "etimedout",
  "sigterm",
  "sigkill",
  "aborted",
  "enoent",
  "econnaborted",
];

function isTransientError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((p) => lower.includes(p));
}

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

export class Executor {
  private ccClient: CCClient;
  private store: Store;
  private abortControllers: Map<string, AbortController> = new Map();
  private running = false;
  private currentRun: ExecutionRun | null = null;
  private evaluationCycles = 0;
  private progressHistory: number[] = [];
  private stopController: AbortController | null = null;
  private config: {
    qualityThreshold: number;
    maxEvaluationCycles: number;
    maxBudgetUsd: number;
    stagnationWindow: number;
    maxTurns: number;
    maxAutoRetries: number;
  };

  constructor(
    private queueManager: QueueManager,
    private notify: NotifyFn,
    private runId: string,
  ) {
    this.ccClient = new CCClient();
    this.store = new Store();
    this.config = {
      qualityThreshold: DEFAULT_QUALITY_THRESHOLD,
      maxEvaluationCycles: DEFAULT_MAX_EVALUATION_CYCLES,
      maxBudgetUsd: DEFAULT_MAX_BUDGET_USD,
      stagnationWindow: DEFAULT_STAGNATION_WINDOW,
      maxTurns: DEFAULT_MAX_TURNS,
      maxAutoRetries: DEFAULT_MAX_AUTO_RETRIES,
    };
    try {
      const keys = ["qualityThreshold", "maxEvaluationCycles", "maxBudgetUsd", "stagnationWindow", "maxTurns", "maxAutoRetries"] as const;
      for (const key of keys) {
        const val = this.store.getConfig(key) as number | undefined;
        if (val !== undefined && val !== null) {
          (this.config as Record<string, unknown>)[key] = val;
        }
      }
    } catch (err) {
      console.warn("[executor] failed to load config from store, using defaults:", err instanceof Error ? err.message : err);
    }
  }

  async start(run: ExecutionRun): Promise<void> {
    this.running = true;
    this.currentRun = run;
    this.stopController = new AbortController();
    this.evaluationCycles = 0;
    this.progressHistory = [];
    this.broadcast("run.status", { runId: run.id, status: "running" });
    this.log(run.id, "engine", "info", "Execution loop started");

    // Initialize unified goal state
    if (!run.goalStatus && run.goals.length > 0) {
      run.goalStatus = "pursuing";
      run.goalBudgetTokens = 500_000;
      run.goalTokensUsed = 0;
      run.goalTimeStartedAt = Date.now();
      run.goalTimeElapsedMs = 0;
      run.goalEvaluationCycles = 0;
      run.goalLastEvalReason = "";
      run.goalEvidence = [];
      this.store.saveRun(run);
      this.broadcast("goal.updated", { runId: run.id, goal: this.serializeGoalState(run) });
    }

    try {
      while (this.running) {
        const task = this.queueManager.dequeue(run.id);

        if (!task) {
          const shouldContinue = await this.handleEmptyQueue(run);
          if (!shouldContinue) break;
          continue;
        }

        this.store.updateTask(run.id, task.id, { status: "running", startedAt: Date.now() });
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "running" });
        this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });

        await this.executeSingleTask(task, run);

        run.totalTasksCompleted++;
        this.store.saveRun(run);

        // Post-task budget guard
        const taskCost = this.recalculateCost(run.id);
        if (taskCost > this.config.maxBudgetUsd) {
          this.log(run.id, "engine", "warn", `Budget exceeded after task: $${taskCost.toFixed(2)} > $${this.config.maxBudgetUsd}. Stopping.`);
          this.broadcast("run.status", { runId: run.id, status: "budget_exceeded", cost: taskCost, budget: this.config.maxBudgetUsd });
          this.stop();
          await this.finalize(run, `Budget exceeded after task ($${taskCost.toFixed(2)}).`);
          break;
        }
      }
    } catch (err) {
      const msg = this.errorToMessage(err);
      this.log(run.id, "engine", "error", `Execution failed: ${msg}`);
      run.status = "failed";
      this.store.saveRun(run);
      this.broadcast("run.status", { runId: run.id, status: "failed", error: msg });
    }
  }

  private async handleEmptyQueue(run: ExecutionRun): Promise<boolean> {
    this.evaluationCycles++;
    this.log(run.id, "engine", "info", `Queue empty — evaluating goals (cycle ${this.evaluationCycles}/${this.config.maxEvaluationCycles})`);

    // Guard: max evaluation cycles
    if (this.evaluationCycles > this.config.maxEvaluationCycles) {
      this.log(run.id, "engine", "warn", `Reached max evaluation cycles (${this.config.maxEvaluationCycles}). Stopping.`);
      await this.finalize(run, "Max evaluation cycles reached. Partial progress may have been made.");
      return false;
    }

    // Guard: budget exceeded
    const currentCost = this.recalculateCost(run.id);
    if (currentCost > this.config.maxBudgetUsd) {
      this.log(run.id, "engine", "warn", `Budget exceeded: $${currentCost.toFixed(2)} > $${this.config.maxBudgetUsd}. Stopping.`);
      await this.finalize(run, `Budget exceeded ($${currentCost.toFixed(2)}).`);
      return false;
    }

    // Evaluate goals (with individual error recovery)
    let evaluation: GoalEvaluation;
    try {
      evaluation = await this.evaluateGoal(run);
    } catch (err) {
      const msg = this.errorToMessage(err);
      this.log(run.id, "engine", "warn", `Goal evaluation failed: ${msg}. Cooling down and retrying next cycle.`);
      try { await this.sleep(CYCLE_COOLDOWN_MS); } catch { console.warn("[executor] sleep interrupted during goal evaluation cooldown"); return false; }
      return true;
    }

    if (!this.running) return false;
    // Guard: stagnation detection
    this.progressHistory.push(evaluation.overallProgress);
    // Trim progressHistory to prevent unbounded growth
    const maxHistory = this.config.stagnationWindow * 2;
    if (this.progressHistory.length > maxHistory) {
      this.progressHistory = this.progressHistory.slice(-maxHistory);
    }
    // Reset evaluation cycles when progress is being made
    if (this.progressHistory.length >= 2) {
      const prev = this.progressHistory[this.progressHistory.length - 2];
      const curr = this.progressHistory[this.progressHistory.length - 1];
      if (curr > prev + 0.01) {
        this.evaluationCycles = Math.floor(this.evaluationCycles / 2);
      }
    }
    if (this.isStagnant()) {
      this.log(run.id, "engine", "warn", `Progress stalled at ${(evaluation.overallProgress * 100).toFixed(0)}% for ${this.config.stagnationWindow} cycles. Stopping.`);
      await this.finalize(run, `Progress stalled at ${(evaluation.overallProgress * 100).toFixed(0)}%.`);
      return false;
    }

    if (evaluation.isComplete) {
      this.log(run.id, "engine", "info", `Goals complete! Progress: ${(evaluation.overallProgress * 100).toFixed(0)}%`);
      await this.finalize(run);
      return false;
    }

    // Check if unified goal state shows budget exhausted
    if (run.goalStatus === "budget_exhausted") {
      this.log(run.id, "engine", "warn", "Goal budget exhausted — wrapping up");
      await this.finalize(run, `Goal budget exhausted. ${run.goalLastEvalReason || ""}`);
      return false;
    }

    // Generate smart tasks (with error recovery)
    this.log(run.id, "engine", "info", `Goals not met (${(evaluation.overallProgress * 100).toFixed(0)}%). Generating smart tasks...`);
    let smartTasks: Array<{ content: string; priority: number; reasoning: string }>;
    try {
      smartTasks = await this.generateSmartTasks(run, evaluation);
    } catch (err) {
      const msg = this.errorToMessage(err);
      this.log(run.id, "engine", "warn", `Smart task generation failed: ${msg}. Retrying next cycle.`);
      try { await this.sleep(CYCLE_COOLDOWN_MS); } catch { console.warn("[executor] sleep interrupted during smart task cooldown"); return false; }
      return true;
    }

    if (!this.running) return false;
    for (const st of smartTasks) {
      const newTask = this.queueManager.enqueue(run.id, {
        content: st.content,
        type: "smart_task",
        priority: st.priority,
      });
      this.store.saveTask(run.id, newTask);
      this.log(run.id, "engine", "info", `Smart task queued: ${st.content.substring(0, 50)}...`);
    }

    this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });

    // Cooldown between evaluation cycles
    try {
      await this.sleep(CYCLE_COOLDOWN_MS);
    } catch {
      console.warn("[executor] sleep interrupted during evaluation cycle cooldown");
      return false;
    }
    return true;
  }

  private async finalize(run: ExecutionRun, partialReport?: string): Promise<void> {
    try {
      const report = await this.generateReport(run);
      run.finalReport = report;
    } catch (reportErr) {
      console.warn("[executor] report generation failed:", reportErr instanceof Error ? reportErr.message : reportErr);
      run.finalReport = partialReport || "Run completed (report generation failed)";
    }
    run.status = "completed";
    run.completedAt = Date.now();
    this.store.saveRun(run);
    this.store.saveReport(run.id, run.finalReport);
    this.broadcast("run.status", { runId: run.id, status: "completed", report: run.finalReport });
  }

  private isStagnant(): boolean {
    if (this.progressHistory.length < this.config.stagnationWindow) return false;
    const recent = this.progressHistory.slice(-this.config.stagnationWindow);
    const first = recent[0];
    const last = recent[recent.length - 1];
    return (last - first) < 0.05;
  }

  private recalculateCost(runId: string): number {
    const tasks = this.store.listTasks(runId);
    return tasks.reduce((sum, t) => sum + (t.costUsd || 0), 0);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (this.stopController?.signal.aborted) {
        clearTimeout(timer);
        reject(new Error("Stopped"));
        return;
      }
      this.stopController?.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Stopped"));
      }, { once: true });
    });
  }

  private async executeSingleTask(task: TaskDefinition, run: ExecutionRun): Promise<void> {
    const gitManager = new GitManager({ workingDir: run.workingDir });
    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);

    try {
      await gitManager.initIfNeeded();
      const context = await this.buildContext(task, run, gitManager);
      const systemPrompt = this.buildSystemPrompt(task, context);

      this.log(run.id, "cc", "info", `Executing: ${task.content.substring(0, 80)}...`);

      const result = await this.ccClient.executeTask(task.content, {
        workingDir: run.workingDir,
        sessionId: task.sessionId,
        timeoutMinutes: task.timeoutMinutes,
        maxTurns: this.config.maxTurns,
        systemPrompt,
        abortSignal: abortController.signal,
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      });

      this.log(run.id, "cc", "info", `CC completed in ${result.durationMs}ms, cost $${result.totalCostUsd.toFixed(4)}`, task.id);
      run.totalCostUsd = this.recalculateCost(run.id) + result.totalCostUsd;

      this.store.updateTask(run.id, task.id, {
        status: "scoring",
        result: result.result,
        sessionId: result.sessionId,
        costUsd: result.totalCostUsd,
        durationMs: result.durationMs,
      });
      this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "scoring" });

      // Quality scoring (with error recovery)
      let score: ScoreDetails;
      try {
        score = await this.scoreTask(task, result.result, run);
      } catch (scoringErr) {
        const scoringMsg = this.errorToMessage(scoringErr);
        this.log(run.id, "scorer", "warn", `Scoring failed: ${scoringMsg} — reverting to be safe`, task.id);
        score = { overall: 0, goalAlignment: 0, correctness: 0, completeness: 0, quality: 0, passed: false, reasoning: `Scoring CC failed: ${scoringMsg}` };
      }

      this.store.appendScore(run.id, task.id, score);
      this.store.updateTask(run.id, task.id, { score: score.overall, scoreDetails: score });
      this.broadcast("task.scored", { taskId: task.id, runId: run.id, score });

      this.log(run.id, "scorer", score.passed ? "info" : "warn",
        `Score: ${(score.overall * 100).toFixed(0)}% — ${score.passed ? "PASS" : "FAIL (reverting)"}`, task.id);

      if (score.passed) {
        const commitHash = await gitManager.autoCommit(task.id, task.content);
        this.log(run.id, "git", "info", `Committed: ${commitHash ? commitHash.substring(0, 7) : "unknown"} #AI commit#`, task.id);
        this.store.appendCommit(run.id, {
          taskId: task.id, runId: run.id, hash: commitHash || "", message: task.content,
          isAiCommit: true, timestamp: Date.now(), additions: 0, deletions: 0,
        });
        this.broadcast("git.commit", { taskId: task.id, runId: run.id, hash: commitHash, message: task.content, isAiCommit: true });
        this.store.updateTask(run.id, task.id, { status: "completed", completedAt: Date.now() });
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "completed" });
      } else {
        let revertSucceeded = true;
        try {
          await gitManager.checkoutClean();
          await gitManager.revert("HEAD");
          this.log(run.id, "git", "warn", "Reverted last commit (quality below threshold)", task.id);
        } catch (revertErr) {
          revertSucceeded = false;
          this.log(run.id, "git", "error", `Revert failed: ${this.errorToMessage(revertErr)}`, task.id);
        }
        this.store.appendLesson(run.id, {
          runId: run.id, taskId: task.id, category: "failure",
          lesson: `Task "${task.content.substring(0, 50)}" scored ${(score.overall * 100).toFixed(0)}%. Reason: ${score.reasoning}`,
          score: score.overall, createdAt: Date.now(),
        });
        const finalStatus: TaskStatus = revertSucceeded ? "reverted" : "failed";
        const failReason = `Score: ${(score.overall * 100).toFixed(0)}% (threshold: ${(this.config.qualityThreshold * 100).toFixed(0)}%). ${score.reasoning}${!revertSucceeded ? " | Revert also failed" : ""}`;
        this.store.updateTask(run.id, task.id, { status: finalStatus, completedAt: Date.now(), errorMessage: failReason });
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: finalStatus, reason: failReason });
      }
    } catch (err) {
      const msg = this.errorToMessage(err);
      const currentTask = this.store.getTask(run.id, task.id);
      const currentRetries = currentTask?.retryCount ?? 0;
      const maxRetries = this.config.maxAutoRetries;

      if (isTransientError(msg) && currentRetries < maxRetries) {
        const backoffMs = Math.min(30000 * Math.pow(2, currentRetries), 300000);
        this.log(run.id, "engine", "warn",
          `Transient error (retry ${currentRetries + 1}/${maxRetries}): ${msg.substring(0, 100)}. Retrying in ${backoffMs / 1000}s.`,
          task.id);
        this.store.updateTask(run.id, task.id, {
          status: "pending",
          retryCount: currentRetries + 1,
          lastError: msg.substring(0, 500),
        });
        const requeued = this.queueManager.enqueue(run.id, {
          content: task.content,
          type: task.type,
          priority: task.priority,
          timeoutMinutes: task.timeoutMinutes,
        });
        this.store.saveTask(run.id, requeued);
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "pending", reason: `Auto-retry ${currentRetries + 1}/${maxRetries}` });
        try { await this.sleep(backoffMs); } catch { /* interrupted by stop */ }
      } else {
        // Clean up any partial changes left by the crashed CC process
        try {
          await gitManager.checkoutClean();
        } catch (cleanupErr) {
          this.log(run.id, "git", "warn", `Working dir cleanup failed: ${this.errorToMessage(cleanupErr)}`, task.id);
        }
        this.log(run.id, "engine", "error", `Task failed permanently: ${msg}`, task.id);
        this.store.updateTask(run.id, task.id, { status: "failed", errorMessage: msg, completedAt: Date.now() });
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "failed", error: msg });
      }
    } finally {
      this.abortControllers.delete(task.id);
    }
  }

  private async buildContext(_task: TaskDefinition, run: ExecutionRun, gitManager: GitManager): Promise<TaskContext> {
    const lastTenCommits = await gitManager.getLastNCommits(10).catch(() => []);
    const nextFiveTasks = this.queueManager.peekNext(run.id, 5);
    const lessons = this.store.getLessons(run.id).slice(-20);

    return {
      workingDir: run.workingDir,
      goals: run.goals,
      terminationConditions: run.terminationConditions,
      lastTenCommits: lastTenCommits.map((c) => ({
        hash: c.hash, message: c.message,
        timestamp: new Date(c.date).getTime(), isAiCommit: c.isAiCommit,
      })),
      nextFiveTasks,
      lessonsLearned: lessons,
    };
  }

  private buildSystemPrompt(_task: TaskDefinition, context: TaskContext): string {
    const parts: string[] = [];

    const goalPrompt = this.buildGoalContinuationPrompt();
    if (goalPrompt) {
      parts.push(goalPrompt);
      parts.push("");
    }

    if (context.lastTenCommits.length > 0) {
      parts.push("Recent git commits:");
      for (const c of context.lastTenCommits) parts.push(`  ${c.hash.substring(0, 7)} ${c.message}`);
    }
    if (context.nextFiveTasks.length > 0) {
      parts.push("\nUpcoming tasks:");
      for (const t of context.nextFiveTasks) parts.push(`  [${t.type}] ${t.content}`);
    }
    if (context.lessonsLearned.length > 0) {
      parts.push("\nLessons from previous tasks:");
      for (const l of context.lessonsLearned.slice(-10)) parts.push(`  [${l.category}] ${l.lesson}`);
    }
    return parts.join("\n");
  }

  private async evaluateGoal(run: ExecutionRun): Promise<GoalEvaluation> {
    const evidence = run.goalEvidence ?? [];
    const evaluationCycles = (run.goalEvaluationCycles ?? 0) + 1;

    const result = await this.ccClient.executeTask(
      `You are a goal evaluator. Your job is to audit whether the following goals have been ACTUALLY achieved based on REAL evidence.

GOALS:
${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}

TERMINATION CONDITIONS:
${run.terminationConditions.map((c, i) => `${i + 1}. ${c}`).join("\n")}

PREVIOUS EVIDENCE COLLECTED:
${evidence.length > 0 ? evidence.map((e, i) => `${i + 1}. ${e}`).join("\n") : "(none yet)"}

INSTRUCTIONS:
1. Check the ACTUAL files, test results, and project state — do NOT infer or assume.
2. Do NOT accept proxy signals as completion (passing tests alone ≠ done, implementation effort ≠ done).
3. Build a checklist mapping the goals' requirements to concrete evidence.
4. Verify coverage comprehensively before declaring success.
5. If you cannot verify something, state what is missing.

Respond ONLY with valid JSON:
{
  "isComplete": boolean,
  "progressReport": "short summary of overall progress",
  "completedGoals": ["goal that was completed"],
  "remainingGoals": ["goal that is still remaining"],
  "overallProgress": 0.0_to_1.0,
  "achieved": boolean,
  "reason": "short explanation of why achieved or not",
  "evidence": ["concrete piece of evidence 1", "concrete piece of evidence 2"],
  "nextSteps": "if not achieved, what specific actions to take next"
}`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 10, allowedTools: ["Read", "Glob", "Grep", "Bash"] },
    );

    try {
      const parsed = JSON.parse(this.extractJson(result.result));

      // Update unified goal state
      run.goalEvaluationCycles = evaluationCycles;
      if (parsed.evidence?.length) {
        run.goalEvidence = [...evidence.slice(-20), ...parsed.evidence];
      }
      if (parsed.reason) {
        run.goalLastEvalReason = parsed.reason;
      }
      if (parsed.achieved) {
        run.goalStatus = "achieved";
      }

      // Token budget tracking (approximate from CC result)
      if (result.totalCostUsd > 0 && run.goalBudgetTokens) {
        // Rough estimate: ~$0.003 per 1K tokens
        const estimatedTokens = Math.round((result.totalCostUsd / 0.003) * 1000);
        run.goalTokensUsed = (run.goalTokensUsed ?? 0) + estimatedTokens;
        if (run.goalTokensUsed >= run.goalBudgetTokens) {
          run.goalStatus = "budget_exhausted";
          run.goalLastEvalReason = `Token budget exhausted: ${run.goalTokensUsed}/${run.goalBudgetTokens}`;
        }
      }

      this.store.saveRun(run);
      this.broadcast("goal.updated", { runId: run.id, goal: this.serializeGoalState(run) });

      return {
        isComplete: parsed.isComplete ?? false,
        progressReport: parsed.progressReport ?? "",
        completedGoals: parsed.completedGoals ?? [],
        remainingGoals: parsed.remainingGoals ?? run.goals,
        overallProgress: parsed.overallProgress ?? 0,
      } as GoalEvaluation;
    } catch (parseErr) {
      console.warn("[executor] failed to parse goal evaluation result:", parseErr instanceof Error ? parseErr.message : parseErr);
      run.goalEvaluationCycles = evaluationCycles;
      run.goalLastEvalReason = "Evaluation parse failed";
      this.store.saveRun(run);
      return { isComplete: false, progressReport: "Evaluation parse failed", completedGoals: [], remainingGoals: run.goals, overallProgress: 0 };
    }
  }

  private async scoreTask(task: TaskDefinition, result: string, run: ExecutionRun): Promise<ScoreDetails> {
    const scoreResult = await this.ccClient.executeTask(
      `Score this task result against goals. Be strict.\nTask: ${task.content}\nResult: ${result.substring(0, 2000)}\nGoals:\n${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}\nRespond ONLY with JSON:\n{ "goalAlignment": 0_to_0.3, "correctness": 0_to_0.3, "completeness": 0_to_0.2, "quality": 0_to_0.2, "reasoning": "brief explanation" }`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 5, allowedTools: ["Read", "Glob", "Grep", "Bash"] },
    );
    try {
      const parsed = JSON.parse(this.extractJson(scoreResult.result));
      const overall = (parsed.goalAlignment || 0) + (parsed.correctness || 0) + (parsed.completeness || 0) + (parsed.quality || 0);
      return { ...parsed, overall, passed: overall >= this.config.qualityThreshold } as ScoreDetails;
    } catch (scoreErr) {
      console.warn("[executor] failed to parse score result:", scoreErr instanceof Error ? scoreErr.message : scoreErr);
      return { overall: 0, goalAlignment: 0, correctness: 0, completeness: 0, quality: 0, passed: false, reasoning: "Failed to parse score" };
    }
  }

  private async generateSmartTasks(run: ExecutionRun, evaluation: GoalEvaluation): Promise<Array<{ content: string; priority: number; reasoning: string }>> {
    const lessons = this.store.getLessons(run.id, "failure").slice(-5);
    const lessonStr = lessons.length > 0 ? `\n\nLessons from failures:\n${lessons.map((l) => `- ${l.lesson}`).join("\n")}` : "";
    const result = await this.ccClient.executeTask(
      `Generate next tasks for this project.\nGoals:\n${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}\nRemaining:\n${evaluation.remainingGoals.map((g, i) => `${i + 1}. ${g}`).join("\n")}\nProgress: ${evaluation.progressReport}${lessonStr}\nGenerate 1-3 tasks. Respond ONLY with JSON array:\n[{ "content": "task description", "priority": 1_to_10, "reasoning": "why" }]`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 10, allowedTools: ["Read", "Glob", "Grep", "Bash"] },
    );
    try {
      return JSON.parse(this.extractJson(result.result));
    } catch (genErr) {
      console.warn("[executor] failed to parse smart task generation result:", genErr instanceof Error ? genErr.message : genErr);
      return [{ content: `Work on: ${evaluation.remainingGoals[0] || "project goals"}`, priority: 5, reasoning: "Fallback task" }];
    }
  }

  private async generateReport(run: ExecutionRun): Promise<string> {
    const tasks = this.store.listTasks(run.id);
    const commits = this.store.getCommits(run.id);
    const cost = this.recalculateCost(run.id);
    const result = await this.ccClient.executeTask(
      `Generate a final summary report.\nGoals:\n${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}\nTasks completed: ${tasks.filter((t) => t.status === "completed").length}\nReverted: ${tasks.filter((t) => t.status === "reverted").length}\nCommits: ${commits.length}\nCost: $${cost.toFixed(4)}\nProvide a concise summary.`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 10, allowedTools: ["Read", "Glob", "Grep", "Bash"] },
    );
    return result.result;
  }

  private extractJson(text: string): string {
    let cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();

    try { JSON.parse(cleaned); return cleaned; } catch (jsonErr) { console.warn(`[executor] Text is not pure JSON, attempting bracket extraction: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`); }

    const findBalanced = (open: string, close: string): string | null => {
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
          try { JSON.parse(candidate); return candidate; } catch (bracketErr) { console.warn(`[executor] Balanced bracket extraction produced invalid JSON: ${bracketErr instanceof Error ? bracketErr.message : String(bracketErr)}`); return null; }
        }
      }
      return null;
    };

    return findBalanced("{", "}") || findBalanced("[", "]") || cleaned;
  }

  private log(runId: string, source: string, level: string, message: string, taskId?: string): void {
    const entry = { timestamp: Date.now(), level, source, message, taskId: taskId || "", runId };
    this.store.appendLog(runId, entry);
    this.broadcast("log.entry", entry);
  }

  private errorToMessage(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }

  private broadcast(method: string, params: Record<string, unknown>): void {
    this.notify(method, params);
  }

  private buildGoalContinuationPrompt(): string {
    const run = this.currentRun;
    if (!run || run.goalStatus !== "pursuing" || !run.goalEvidence) return "";

    const objective = run.goals.join("\n");
    const evidence = run.goalEvidence;
    return `[GOAL CONTEXT — This task is part of an ongoing goal pursuit]
OBJECTIVE: ${objective}
EVALUATION CYCLE: ${run.goalEvaluationCycles ?? 0}
LAST EVALUATION: ${run.goalLastEvalReason || "(first cycle)"}
COLLECTED EVIDENCE SO FAR:
${evidence.length > 0 ? evidence.map((e, i) => `${i + 1}. ${e}`).join("\n") : "(none yet)"}

IMPORTANT: After completing this task, you should verify your work contributes to the objective above. Focus on producing concrete, verifiable results.`;
  }

  private serializeGoalState(run: ExecutionRun): Record<string, unknown> {
    return {
      status: run.goalStatus ?? "unmet",
      tokensUsed: run.goalTokensUsed ?? 0,
      budgetTokens: run.goalBudgetTokens ?? 500_000,
      timeElapsedMs: run.goalTimeElapsedMs ?? 0,
      evaluationCycles: run.goalEvaluationCycles ?? 0,
      lastEvaluationReason: run.goalLastEvalReason ?? "",
      evidence: run.goalEvidence ?? [],
    };
  }

  cancelTask(taskId: string, runId: string): void {
    const controller = this.abortControllers.get(taskId);
    if (controller) controller.abort();
    this.store.updateTask(runId, taskId, { status: "cancelled", completedAt: Date.now() });
  }

  stop(): void {
    if (this.currentRun?.goalStatus === "pursuing") {
      this.currentRun.goalTimeElapsedMs = Date.now() - (this.currentRun.goalTimeStartedAt ?? Date.now());
      this.store.saveRun(this.currentRun);
    }
    this.running = false;
    this.stopController?.abort();
    for (const [id, controller] of this.abortControllers) {
      controller.abort();
      this.store.updateTask(this.runId, id, { status: "cancelled", completedAt: Date.now() });
    }
    this.abortControllers.clear();
  }
}
