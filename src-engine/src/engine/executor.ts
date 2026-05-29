import type { TaskDefinition, ExecutionRun, TaskContext, GoalEvaluation, ScoreDetails, TaskStatus, CheckpointType } from "@ai-workbench/shared";
import { CCClient } from "../cc-integration/cc-client.js";
import { GitManager } from "../git/git-manager.js";
import { Store } from "../db/store.js";
import { SkillStore } from "../db/skill-store.js";
import { SkillManager } from "../skills/skill-manager.js";
import { generateClaudeMd } from "../skills/claude-md-generator.js";
import type { QueueManager } from "./queue-manager.js";
import { ApprovalGate, type ApprovalDecision } from "./approval-gate.js";
import { TaskPipeline, type PipelineResult } from "./task-pipeline.js";

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
  private skillManager: SkillManager;
  private abortControllers: Map<string, AbortController> = new Map();
  private running = false;
  private currentRun: ExecutionRun | null = null;
  private evaluationCycles = 0;
  private progressHistory: number[] = [];
  private stopController: AbortController | null = null;
  private approvalGate: ApprovalGate | null = null;
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
    this.skillManager = new SkillManager(new SkillStore(), () => {});
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
      // Generate feature list on first run
      if (!run.featuresGeneratedAt && run.goals.length > 0) {
        await this.generateFeatures(run);
      }

      while (this.running) {
        // Sequential mode (default)
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
      // ─── Checkpoint: goal_stagnation ──────────────────────
      this.log(run.id, "engine", "warn", "Progress stalled — requesting human guidance");
      const lessons = this.store.getLessons(run.id, "failure").slice(-5);
      const decision = await this.checkApproval(
        "goal_stagnation", run, null,
        "Progress stalled at " + (evaluation.overallProgress * 100).toFixed(0) + "%. Continue, stop, or redirect?",
        { progressHistory: this.progressHistory.slice(-10), evaluation, lessons },
      );
      if (!decision || decision.action === "reject") {
        await this.finalize(run, "Progress stalled. Human decided to stop.");
        return false;
      }
      if (decision.action === "modify" && decision.instructions) {
        this.log(run.id, "engine", "info", "Human redirection: " + decision.instructions);
        // Inject as a high-priority user task
        const redirectTask = this.queueManager.enqueue(run.id, {
          content: decision.instructions,
          type: "user_defined",
          priority: 1,
        });
        this.store.saveTask(run.id, redirectTask);
        this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });
      }
      // Reset stagnation tracking after human intervention
      this.progressHistory = [];
      this.evaluationCycles = 0;
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
      await gitManager.ensureInit();

      // Inject skills and generate CLAUDE.md
      this.skillManager.prepareWorkingDir(run.workingDir);
      const context = await this.buildContext(task, run, gitManager);
      generateClaudeMd(run.workingDir, context);

      this.log(run.id, "pipeline", "info", `Executing via TaskPipeline: ${task.content.substring(0, 80)}...`);

      // Use TaskPipeline for structured execution
      const pipeline = new TaskPipeline(this.ccClient, this.broadcast.bind(this), run.workingDir);
      const pipelineResult: PipelineResult = await pipeline.run(task, context, abortController.signal);

      this.log(run.id, "pipeline", "info", `Pipeline completed in ${pipelineResult.durationMs}ms (${pipelineResult.iterations} iteration${pipelineResult.iterations > 1 ? "s" : ""}), cost $${pipelineResult.totalCostUsd.toFixed(4)}`, task.id);
      run.totalCostUsd = this.recalculateCost(run.id) + pipelineResult.totalCostUsd;

      this.store.updateTask(run.id, task.id, {
        status: "scoring",
        result: pipelineResult.finalOutput,
        sessionId: pipelineResult.sessionId,
        costUsd: pipelineResult.totalCostUsd,
        durationMs: pipelineResult.durationMs,
        pipelinePhases: pipelineResult.phases,
        pipelineIterations: pipelineResult.iterations,
      });
      this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "scoring" });

      // Quality scoring: prefer reviewer score from pipeline, fallback to scoreTask()
      let score: ScoreDetails;
      if (pipelineResult.reviewResult) {
        const review = pipelineResult.reviewResult;
        const overall = Math.min(review.score, 1); // reviewResult.score is already 0-1
        score = {
          overall,
          goalAlignment: overall * 0.3,
          correctness: overall * 0.3,
          completeness: overall * 0.2,
          quality: overall * 0.2,
          passed: overall >= this.config.qualityThreshold,
          reasoning: review.summary || `Pipeline review score: ${review.score}`,
        };
      } else {
        try {
          score = await this.scoreTask(task, pipelineResult.finalOutput, run);
        } catch (scoringErr) {
          const scoringMsg = this.errorToMessage(scoringErr);
          this.log(run.id, "scorer", "warn", `Scoring failed: ${scoringMsg} — reverting to be safe`, task.id);
          score = { overall: 0, goalAlignment: 0, correctness: 0, completeness: 0, quality: 0, passed: false, reasoning: `Scoring CC failed: ${scoringMsg}` };
        }
      }

      this.store.appendScore(run.id, task.id, score);
      this.store.updateTask(run.id, task.id, { score: score.overall, scoreDetails: score });
      this.broadcast("task.scored", { taskId: task.id, runId: run.id, score });

      this.log(run.id, "scorer", score.passed ? "info" : "warn",
        `Score: ${(score.overall * 100).toFixed(0)}% — ${score.passed ? "PASS" : "FAIL (reverting)"}`, task.id);

      // ─── Checkpoint: borderline_score ─────────────────────
      const scoreDiff = Math.abs(score.overall - this.config.qualityThreshold);
      if (scoreDiff < 0.15) {
        this.log(run.id, "engine", "info", "Borderline score — requesting human decision", task.id);
        const diffStats = await this.getDiffStats(gitManager);
        const decision = await this.checkApproval(
          "borderline_score", run, task,
          "Score near threshold. Commit or revert?",
          { score, diffStats, taskContent: task.content },
        );
        if (decision?.action === "reject") {
          score.passed = false;
        } else if (decision?.action === "approve" && !score.passed) {
          score.passed = true;
        }
        if (decision?.instructions) {
          this.log(run.id, "engine", "info", "Human instruction: " + decision.instructions, task.id);
        }
      }

      // ─── Checkpoint: risky_commit ─────────────────────────
      if (score.passed) {
        const diffStats = await this.getDiffStats(gitManager);
        const isRisky = diffStats.filesChanged > 10
          || diffStats.linesChanged > 200
          || diffStats.hasCriticalFiles;
        if (isRisky) {
          this.log(run.id, "engine", "info", "Risky commit — requesting human review", task.id);
          const decision = await this.checkApproval(
            "risky_commit", run, task,
            "Large change: " + diffStats.filesChanged + " files, " + diffStats.linesChanged + " lines. Review?",
            { diffStats, taskContent: task.content },
          );
          if (decision?.action === "reject") {
            score.passed = false;
          }
          if (decision?.instructions) {
            this.log(run.id, "engine", "info", "Human instruction: " + decision.instructions, task.id);
          }
        }
      }

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

        // Verify features after successful commit
        if (run.features && run.features.length > 0) {
          await this.verifyFeatures(run);
        }
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
    this.approvalGate?.abort();
    this.approvalGate = null;
    for (const [id, controller] of this.abortControllers) {
      controller.abort();
      this.store.updateTask(this.runId, id, { status: "cancelled", completedAt: Date.now() });
    }
    this.abortControllers.clear();
  }

  // ─── Approval integration ──────────────────────────────────────────────

  private async checkApproval(
    checkpointType: CheckpointType,
    run: ExecutionRun,
    task: TaskDefinition | null,
    summary: string,
    contextData: Record<string, unknown>,
  ): Promise<ApprovalDecision | null> {
    const timeoutMs = run.approvalTimeoutMs || 30 * 60 * 1000;

    this.approvalGate = new ApprovalGate(this.store, (method, params) => this.broadcast(method, params));

    try {
      const decision = await this.approvalGate.waitForApproval(
        run.id,
        task?.id,
        checkpointType,
        summary,
        contextData,
        timeoutMs,
      );

      this.broadcast("approval.resolved", {
        approvalId: this.approvalGate.pendingApprovalId,
        runId: run.id,
        status: decision.timedOut ? "timed_out" : decision.action === "approve" ? "approved" : decision.action === "reject" ? "rejected" : "modified",
      });

      return decision;
    } catch (err) {
      this.log(run.id, "engine", "warn", `Approval wait interrupted: ${this.errorToMessage(err)}`);
      return null;
    } finally {
      this.approvalGate = null;
    }
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision): boolean {
    if (!this.approvalGate) return false;
    return this.approvalGate.resolve(approvalId, decision);
  }

  private async getDiffStats(gitManager: GitManager): Promise<{
    filesChanged: number;
    linesChanged: number;
    hasCriticalFiles: boolean;
  }> {
    return gitManager.getDiffStats();
  }

  private async generateFeatures(run: ExecutionRun): Promise<void> {
    this.log(run.id, "engine", "info", "Generating feature list for goal tracking...");
    try {
      const schema: Record<string, unknown> = {
        type: "object",
        properties: {
          features: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                category: { type: "string", enum: ["functional", "non_functional", "edge_case"] },
                description: { type: "string" },
                steps: { type: "array", items: { type: "string" } },
                priority: { type: "number" },
              },
              required: ["id", "category", "description", "steps", "priority"],
            },
          },
        },
        required: ["features"],
      };

      const prompt = `Based on these goals and the project at ${run.workingDir}, generate a comprehensive feature checklist.
Goals: ${run.goals.join("; ")}
Termination conditions: ${run.terminationConditions.join("; ")}

Generate 30-100 verifiable features covering:
1. Functional requirements (core features, API endpoints, data flows)
2. Non-functional requirements (performance, security, error handling)
3. Edge cases (error states, boundary conditions, concurrent access)

Each feature should have:
- A unique id (e.g., "feat-001")
- category: functional / non_functional / edge_case
- description: what should work
- steps: verification steps (array of strings)
- priority: 1-5 (1=critical, 5=nice-to-have)

Return ONLY the JSON object.`;

      const result = await this.ccClient.executeTask(prompt, {
        workingDir: run.workingDir,
        timeoutMinutes: 5,
        maxTurns: 3,
        jsonSchema: schema,
        abortSignal: this.stopController?.signal,
      });

      const parsed = JSON.parse(result.result) as { features: Array<{
        id: string; category: "functional" | "non_functional" | "edge_case";
        description: string; steps: string[]; priority: number;
      }> };

      const features: import("@ai-workbench/shared").FeatureItem[] = parsed.features.map((f) => ({
        ...f,
        passes: false,
      }));

      run.features = features;
      run.featuresGeneratedAt = Date.now();
      this.store.saveRun(run);
      this.broadcast("features.generated", { runId: run.id, total: features.length });
      this.log(run.id, "engine", "info", `Generated ${features.length} features for tracking`);
    } catch (err) {
      this.log(run.id, "engine", "warn", `Feature generation failed (non-fatal): ${this.errorToMessage(err)}`);
    }
  }

  private async verifyFeatures(run: ExecutionRun): Promise<void> {
    if (!run.features || run.features.length === 0) return;

    const unverified = run.features.filter((f) => !f.passes);
    if (unverified.length === 0) return;

    // Sample up to 10 features per verification pass to control cost
    const sample = unverified.slice(0, 10);

    try {
      const featureList = sample.map((f) =>
        `[${f.id}] (${f.category}, P${f.priority}) ${f.description}\n  Verify: ${f.steps.join("; ")}`
      ).join("\n");

      const schema: Record<string, unknown> = {
        type: "object",
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                passes: { type: "boolean" },
              },
              required: ["id", "passes"],
            },
          },
        },
        required: ["results"],
      };

      const prompt = `Verify these features in the project at ${run.workingDir}:

${featureList}

For each feature, check if it currently passes by reading the relevant source files and tests.
Return a JSON object with "results" array containing { id, passes } for each feature.`;

      const result = await this.ccClient.executeTask(prompt, {
        workingDir: run.workingDir,
        timeoutMinutes: 5,
        maxTurns: 5,
        jsonSchema: schema,
        abortSignal: this.stopController?.signal,
      });

      const parsed = JSON.parse(result.result) as { results: Array<{ id: string; passes: boolean }> };

      let passed = 0;
      for (const r of parsed.results) {
        const feature = run.features.find((f) => f.id === r.id);
        if (feature && r.passes && !feature.passes) {
          feature.passes = true;
          feature.verifiedAt = Date.now();
          feature.verifiedBy = "auto";
          passed++;
        }
      }

      if (passed > 0) {
        this.store.saveRun(run);
        const totalPassed = run.features.filter((f) => f.passes).length;
        this.broadcast("features.updated", { runId: run.id, passed: totalPassed, total: run.features.length });
        this.log(run.id, "engine", "info", `Features verified: +${passed} passed (${totalPassed}/${run.features.length} total)`);
      }
    } catch (err) {
      this.log(run.id, "engine", "warn", `Feature verification failed (non-fatal): ${this.errorToMessage(err)}`);
    }
  }
}
