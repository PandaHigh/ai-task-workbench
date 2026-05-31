import fs from "fs";
import path from "path";
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
import { ErrorWatcher } from "./error-watcher.js";
import { BackgroundReviewer } from "./agents/background-reviewer.js";
import { AgentExecutor } from "./agents/agent-executor.js";
import { AdaptiveConfig } from "./adaptive-config.js";
import { BranchStrategy } from "../git/branch-strategy.js";
import { DAGScheduler } from "./dag-scheduler.js";
import { ExecutionPool } from "./execution-pool.js";
import type { OrchestratorProfile } from "@ai-workbench/shared";

import { errorToMessage } from "../lib/error-utils.js";
import { classifyError, getRetryStrategy, TaskError } from "../lib/error-types.js";
import { extractJson } from "../lib/json-extract.js";
import { serializeGoalState } from "../lib/goal-utils.js";
import { Tracer } from "../lib/tracer.js";

const DEFAULT_QUALITY_THRESHOLD = 0.6;
const DEFAULT_MAX_EVALUATION_CYCLES = 1000;
const DEFAULT_MAX_BUDGET_USD = Infinity;
const DEFAULT_STAGNATION_WINDOW = 5;
const DEFAULT_MAX_TURNS = 50;
const DEFAULT_MAX_AUTO_RETRIES = 3;
const CYCLE_COOLDOWN_MS = 5000;

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

function sanitizePromptInput(input: string): string {
  return input
    .replace(/```/g, "``​`") // break code blocks
    .replace(/<system[^>]*>/gi, "[filtered]") // filter system tags
    .replace(/\bignore\s+(previous|above|all)\s+(instructions?|rules?)/gi, "[filtered]")
    .substring(0, 2000); // limit length
}

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
  private tracer: Tracer;
  private errorWatcher: ErrorWatcher;
  private activeProfile: OrchestratorProfile | null = null;
  private cachedCost: number | null = null;
  private maxConcurrency: number = 1;
  private config: {
    qualityThreshold: number;
    maxEvaluationCycles: number;
    maxBudgetUsd: number;
    stagnationWindow: number;
    maxTurns: number;
    maxAutoRetries: number;
    branchStrategy: "direct" | "feature-branch";
    maxConcurrentTasks: number;
  };

  constructor(
    private queueManager: QueueManager,
    private notify: NotifyFn,
    private runId: string,
  ) {
    const store = new Store();
    this.store = store;
    this.ccClient = new CCClient((store.getConfig("claudePath") as string) || undefined);
    this.skillManager = new SkillManager(new SkillStore(), () => {});
    this.tracer = new Tracer(notify, (spans) => {
      this.store.syncTraces(this.runId, spans);
    });
    this.config = {
      qualityThreshold: DEFAULT_QUALITY_THRESHOLD,
      maxEvaluationCycles: DEFAULT_MAX_EVALUATION_CYCLES,
      maxBudgetUsd: DEFAULT_MAX_BUDGET_USD,
      stagnationWindow: DEFAULT_STAGNATION_WINDOW,
      maxTurns: DEFAULT_MAX_TURNS,
      maxAutoRetries: DEFAULT_MAX_AUTO_RETRIES,
      branchStrategy: "direct",
      maxConcurrentTasks: 1,
    };
    try {
      const keys = ["qualityThreshold", "maxEvaluationCycles", "maxBudgetUsd", "stagnationWindow", "maxTurns", "maxAutoRetries", "branchStrategy", "maxConcurrentTasks"] as const;
      for (const key of keys) {
        const val = this.store.getConfig(key) as number | undefined;
        if (val !== undefined && val !== null) {
          (this.config as Record<string, unknown>)[key] = val;
        }
      }
    } catch (err) {
      console.warn("[executor] failed to load config from store, using defaults:", errorToMessage(err));
    }

    this.errorWatcher = new ErrorWatcher(notify, this.store);
  }

  async start(run: ExecutionRun): Promise<void> {
    this.running = true;
    this.currentRun = run;
    this.stopController = new AbortController();
    this.evaluationCycles = 0;
    this.progressHistory = [];
    this.broadcast("run.status", { runId: run.id, status: "running" });
    this.log(run.id, "engine", "info", "Execution loop started");

    this.maxConcurrency = run.maxConcurrentTasks ?? this.config.maxConcurrentTasks;

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
      this.broadcast("goal.updated", { runId: run.id, goal: serializeGoalState(run) });
    }

    try {
      // Generate feature list on first run
      if (!run.featuresGeneratedAt && run.goals.length > 0) {
        await this.generateFeatures(run);
      }

      while (this.running) {
        // Maintain a set of completed task IDs for DAG-aware scheduling
        const completedTaskIds = new Set<string>(
          this.store.listTasks(run.id)
            .filter(t => t.status === "completed")
            .map(t => t.id)
        );

        // DAG-aware dequeue: skips tasks whose dependencies are not met
        const task = this.queueManager.dequeueWithDeps(run.id, completedTaskIds);

        if (!task) {
          const shouldContinue = await this.handleEmptyQueue(run);
          if (!shouldContinue) break;
          continue;
        }

        // Single-task mode (maxConcurrentTasks = 1) — original sequential logic
        if (this.maxConcurrency <= 1) {
          // Autonomy gate: supervised mode requires approval before each task
          if (run.autonomyLevel === "supervised") {
            this.log(run.id, "engine", "info", `Supervised mode — awaiting approval for task: ${task.content.substring(0, 60)}`);
            const decision = await this.checkApproval(
              "risky_commit", run, task,
              `Supervised mode: approve execution of "${task.content.substring(0, 80)}"?`,
              { taskContent: task.content },
            );
            if (!decision || decision.action === "reject") {
              this.log(run.id, "engine", "info", "Task rejected by human in supervised mode");
              this.store.updateTask(run.id, task.id, { status: "cancelled", completedAt: Date.now() });
              this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "cancelled", reason: "Rejected in supervised mode" });
              continue;
            }
          }

          this.store.updateTask(run.id, task.id, { status: "running", startedAt: Date.now() });
          this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "running" });
          this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });

          await this.executeSingleTask(task, run);

          run.totalTasksCompleted++;
          this.store.saveRun(run);
        } else {
          // Parallel mode — drain all ready tasks via ExecutionPool
          await this.runParallelTasks(run, task);
        }

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
      const msg = errorToMessage(err);
      this.log(run.id, "engine", "error", `Execution failed: ${msg}`);
      run.status = "failed";
      this.store.saveRun(run);
      this.broadcast("run.status", { runId: run.id, status: "failed", reason: msg });
    }
  }

  private async runParallelTasks(run: ExecutionRun, firstTask: TaskDefinition): Promise<void> {
    const completedTaskIds = new Set<string>(
      this.store.listTasks(run.id)
        .filter(t => t.status === "completed")
        .map(t => t.id)
    );

    // Gather all ready tasks
    const readyTasks = [firstTask];
    while (true) {
      const next = this.queueManager.dequeueWithDeps(run.id, completedTaskIds);
      if (!next) break;
      readyTasks.push(next);
      if (readyTasks.length >= this.maxConcurrency) break;
    }

    if (readyTasks.length === 1) {
      // Only one task ready — fall back to sequential
      this.store.updateTask(run.id, firstTask.id, { status: "running", startedAt: Date.now() });
      this.broadcast("task.status", { taskId: firstTask.id, runId: run.id, status: "running" });
      this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });
      await this.executeSingleTask(firstTask, run);
      run.totalTasksCompleted++;
      this.store.saveRun(run);
      return;
    }

    // Build DAG scheduler for these tasks with execution context
    const allTasks = this.store.listTasks(run.id);
    const scheduler = new DAGScheduler(allTasks, {
      lastScore: 0,
      lastStatus: "pending",
      cycleCount: this.evaluationCycles,
      completedCount: completedTaskIds.size,
      failedCount: this.store.listTasks(run.id).filter(t => t.status === "failed" || t.status === "reverted").length,
    });
    for (const id of completedTaskIds) scheduler.markCompleted(id);

    this.log(run.id, "engine", "info", `Parallel execution: ${readyTasks.length} tasks with concurrency ${this.maxConcurrency}`);

    // Mark tasks as running
    for (const t of readyTasks) {
      this.store.updateTask(run.id, t.id, { status: "running", startedAt: Date.now() });
      this.broadcast("task.status", { taskId: t.id, runId: run.id, status: "running" });
    }
    this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });

    const pool = new ExecutionPool(
      (task) => this.executeSingleTask(task, run),
      this.maxConcurrency,
    );

    const results = await pool.runAll(readyTasks, scheduler, (task) => {
      const stored = this.store.getTask(run.id, task.id);
      scheduler.updateContext({
        lastScore: stored?.score ?? 0,
        lastStatus: stored?.status ?? "completed",
      });
    });

    let completedCount = 0;
    for (const r of results) {
      if (r.success) completedCount++;
    }
    run.totalTasksCompleted += completedCount;
    this.store.saveRun(run);

    this.cachedCost = null;
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
    // Evaluate goals (with individual error recovery)
    let evaluation: GoalEvaluation;
    try {
      evaluation = await this.evaluateGoal(run);
    } catch (err) {
      const msg = errorToMessage(err);
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

    // Generate smart tasks (with error recovery)
    this.log(run.id, "engine", "info", `Goals not met (${(evaluation.overallProgress * 100).toFixed(0)}%). Generating smart tasks...`);
    let smartTasks: Array<{ content: string; priority: number; reasoning: string }>;
    try {
      smartTasks = await this.generateSmartTasks(run, evaluation);
    } catch (err) {
      const msg = errorToMessage(err);
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
      console.warn("[executor] report generation failed:", errorToMessage(reportErr));
      run.finalReport = partialReport || "Run completed (report generation failed)";
    }
    run.status = "completed";
    run.completedAt = Date.now();
    this.store.saveRun(run);
    this.store.saveReport(run.id, run.finalReport);

    // Generate README.md in working directory
    try {
      const tasks = this.store.listTasks(run.id);
      const commits = this.store.getCommits(run.id);
      const lessons = this.store.getLessons(run.id);
      const totalCost = this.recalculateCost(run.id);
      const { generateReadme } = await import("../lib/readme-generator.js");
      const readmeContent = generateReadme({ run, tasks, commits, lessons, report: run.finalReport, totalCost });
      fs.writeFileSync(path.join(run.workingDir, "README.md"), readmeContent, "utf-8");
      this.log(run.id, "engine", "info", "README.md generated in working directory");
    } catch (readmeErr) {
      console.warn("[executor] README generation failed:", errorToMessage(readmeErr));
    }

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
    if (this.cachedCost !== null) return this.cachedCost;
    const tasks = this.store.listTasks(runId);
    const cost = tasks.reduce((sum, t) => sum + (t.costUsd || 0), 0);
    this.cachedCost = cost;
    return cost;
  }

  private loadProfile(): OrchestratorProfile | null {
    try {
      const profileId = (this.store.getConfig("activeProfile") as string | undefined) || "adaptive";
      const adaptive = new AdaptiveConfig({});
      const builtIn = adaptive.getBuiltInProfiles();
      return builtIn.find((p) => p.id === profileId) ?? this.store.listProfiles().find((p) => p.id === profileId) ?? null;
    } catch (err) {
      console.warn("[executor] loadProfile failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopController?.signal.aborted) {
        reject(new Error("Stopped"));
        return;
      }
      let timer: ReturnType<typeof setTimeout>;
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error("Stopped"));
      };
      this.stopController?.signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        this.stopController?.signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
    });
  }

  private async executeSingleTask(task: TaskDefinition, run: ExecutionRun): Promise<void> {
    const gitManager = new GitManager({ workingDir: run.workingDir });
    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);

    // Feature branch isolation (auto-enable when concurrency > 1)
    const useFeatureBranch = this.config.branchStrategy === "feature-branch" || this.maxConcurrency > 1;
    let branchResult: { branchName: string; worktreePath: string } | null = null;

    if (useFeatureBranch) {
      try {
        branchResult = await BranchStrategy.createTaskBranch(run.workingDir, task.id);
        this.store.updateTask(run.id, task.id, { branchName: branchResult.branchName, worktreePath: branchResult.worktreePath });
        this.log(run.id, "engine", "info", `Created feature branch: ${branchResult.branchName}`);
      } catch (err) {
        this.log(run.id, "engine", "warn", `Failed to create feature branch, falling back to direct: ${err instanceof Error ? err.message : err}`);
      }
    }

    try {
      await gitManager.ensureInit();

      // Inject skills and generate CLAUDE.md in the correct working directory
      const pipelineWorkingDir = branchResult?.worktreePath || run.workingDir;
      this.skillManager.prepareWorkingDir(pipelineWorkingDir);
      const context = await this.buildContext(task, run, gitManager);
      generateClaudeMd(pipelineWorkingDir, context);

      this.log(run.id, "pipeline", "info", `Executing via TaskPipeline: ${task.content.substring(0, 80)}...`);

      // Start trace for this task
      this.tracer.startTrace();
      const taskSpanId = this.tracer.startSpan("task.execute", undefined, { taskId: task.id, content: task.content.substring(0, 100) });

      // Load active profile for pipeline config
      this.activeProfile = this.loadProfile();

      // Use TaskPipeline for structured execution
      const pipelineConfig = {
        maxFixIterations: this.activeProfile?.config?.maxFixIterations ?? ((this.store.getConfig("maxFixIterations") as number) || undefined),
        plannerMaxTurns: this.activeProfile?.config?.agents?.planner?.maxTurns ?? ((this.store.getConfig("plannerMaxTurns") as number) || undefined),
        developerMaxTurns: this.activeProfile?.config?.agents?.developer?.maxTurns ?? ((this.store.getConfig("developerMaxTurns") as number) || undefined),
        testerMaxTurns: this.activeProfile?.config?.agents?.tester?.maxTurns ?? ((this.store.getConfig("testerMaxTurns") as number) || undefined),
        reviewerMaxTurns: this.activeProfile?.config?.agents?.reviewer?.maxTurns ?? ((this.store.getConfig("reviewerMaxTurns") as number) || undefined),
        stderrCallback: this.activeProfile?.config?.errorWatchEnabled
          ? (data: string) => this.errorWatcher.processStderr(data, run.id, task.id)
          : undefined,
      };
      const pipeline = new TaskPipeline(this.ccClient, this.broadcast.bind(this), pipelineWorkingDir, pipelineConfig);
      const pipelineResult: PipelineResult = await pipeline.run(task, context, abortController.signal);

      this.log(run.id, "pipeline", "info", `Pipeline completed in ${pipelineResult.durationMs}ms (${pipelineResult.iterations} iteration${pipelineResult.iterations > 1 ? "s" : ""}), cost $${pipelineResult.totalCostUsd.toFixed(4)}`, task.id);
      run.totalCostUsd = this.recalculateCost(run.id) + pipelineResult.totalCostUsd;
      this.cachedCost = null; // invalidate since costs changed

      // End trace and persist
      this.tracer.endSpan(taskSpanId, "ok", { costUsd: pipelineResult.totalCostUsd, durationMs: pipelineResult.durationMs });
      const traceSpans = this.tracer.endTrace();
      if (traceSpans.length > 0) {
        this.store.appendTrace(run.id, traceSpans);
      }

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
          const scoringMsg = errorToMessage(scoringErr);
          this.log(run.id, "scorer", "warn", `Scoring failed: ${scoringMsg} — reverting to be safe`, task.id);
          score = { overall: 0, goalAlignment: 0, correctness: 0, completeness: 0, quality: 0, passed: false, reasoning: `Scoring CC failed: ${scoringMsg}` };
        }
      }

      this.store.appendScore(run.id, task.id, score);
      this.store.updateTask(run.id, task.id, { score: score.overall, scoreDetails: score });
      this.broadcast("task.scored", { taskId: task.id, runId: run.id, score });

      // Background review (non-blocking, runs in separate worktree)
      if (this.activeProfile?.config?.backgroundReview) {
        const bgReviewer = new BackgroundReviewer(
          new AgentExecutor(this.ccClient, this.broadcast.bind(this)),
          this.store,
          this.broadcast.bind(this),
        );
        bgReviewer.runBackgroundReview({
          runId: run.id,
          taskId: task.id,
          workingDir: run.workingDir,
          plan: pipelineResult.plan,
          testResult: pipelineResult.testResult,
        }).catch((err) => {
          this.log(run.id, "reviewer", "warn", `Background review failed: ${errorToMessage(err)}`, task.id);
        });
      }

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
          this.log(run.id, "git", "error", `Revert failed: ${errorToMessage(revertErr)}`, task.id);
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
      const taskErr = classifyError(err);
      // End trace on error
      try {
        const traceSpans = this.tracer.endTrace();
        if (traceSpans.length > 0) {
          this.store.appendTrace(run.id, traceSpans);
        }
      } catch (traceErr) { console.warn("[executor] trace cleanup failed:", traceErr instanceof Error ? traceErr.message : traceErr); }

      // Check ErrorWatcher for critical error accumulation
      const detectedErrors = this.store.getDetectedErrors(run.id, task.id);
      if (detectedErrors.filter((e) => e.severity === "critical").length >= 3 && taskErr.retryable) {
        this.log(run.id, "engine", "warn", `3+ critical errors detected — degrading to permanent`, task.id);
        const degraded = new TaskError(`Too many critical errors: ${taskErr.message}`, "permanent", { cause: taskErr });
        this.handleFailedTask(run, task, degraded, gitManager);
        return;
      }

      const strategy = getRetryStrategy(taskErr.category);
      const currentTask = this.store.getTask(run.id, task.id);
      const currentRetries = currentTask?.retryCount ?? 0;

      if (strategy.shouldRetry && currentRetries < strategy.maxRetries) {
        const backoffMs = Math.min(strategy.backoffMs * Math.pow(2, currentRetries), 300000);
        const categoryLabel = taskErr.category;
        this.log(run.id, "engine", "warn",
          `${categoryLabel} error (retry ${currentRetries + 1}/${strategy.maxRetries}): ${taskErr.message.substring(0, 100)}. Retrying in ${backoffMs / 1000}s.`,
          task.id);
        this.store.updateTask(run.id, task.id, {
          status: "pending",
          retryCount: currentRetries + 1,
          lastError: taskErr.message.substring(0, 500),
        });
        const requeued = this.queueManager.enqueue(run.id, {
          content: task.content,
          type: task.type,
          priority: task.priority,
          timeoutMinutes: task.timeoutMinutes,
        });
        this.store.saveTask(run.id, requeued);
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "pending", reason: `Auto-retry ${currentRetries + 1}/${strategy.maxRetries} (${categoryLabel})` });

        // Pause run if needed (e.g., rate limiting)
        if (strategy.pauseRunMs > 0) {
          this.log(run.id, "engine", "warn", `Pausing run for ${strategy.pauseRunMs / 1000}s (${categoryLabel})`);
          try { await this.sleep(strategy.pauseRunMs); } catch (sleepErr) { if (!(sleepErr instanceof Error && sleepErr.message === "Stopped")) console.warn("[executor] sleep interrupted:", sleepErr instanceof Error ? sleepErr.message : sleepErr); }
        }
        try { await this.sleep(backoffMs); } catch (sleepErr) { if (!(sleepErr instanceof Error && sleepErr.message === "Stopped")) console.warn("[executor] sleep interrupted:", sleepErr instanceof Error ? sleepErr.message : sleepErr); }
      } else if (taskErr.category === "quota_exceeded") {
        this.log(run.id, "engine", "error", `Quota exceeded: ${taskErr.message}`);
        this.stop();
        await this.finalize(run, taskErr.message);
      } else {
        this.handleFailedTask(run, task, taskErr, gitManager);
      }
    } finally {
      this.abortControllers.delete(task.id);
      this.cachedCost = null;

      // Merge and clean up feature branch
      if (useFeatureBranch && branchResult) {
        try {
          const mergeResult = await BranchStrategy.mergeBranch(
            run.workingDir,
            branchResult.branchName,
          );
          if (mergeResult.success) {
            this.log(run.id, "engine", "info", `Merged feature branch: ${branchResult.branchName}`);
          } else {
            this.log(run.id, "engine", "warn", `Merge conflicts on ${branchResult.branchName}: ${mergeResult.conflicts?.join(", ")}`);
          }
        } catch (err) {
          this.log(run.id, "engine", "error", `Failed to merge feature branch: ${err instanceof Error ? err.message : err}`);
        } finally {
          await BranchStrategy.cleanupBranch(run.workingDir, branchResult.branchName, branchResult.worktreePath);
        }
      }
    }
  }

  private async handleFailedTask(
    run: ExecutionRun, task: TaskDefinition, taskErr: TaskError, gitManager: GitManager,
  ): Promise<void> {
    try {
      await gitManager.checkoutClean();
    } catch (cleanupErr) {
      this.log(run.id, "git", "warn", `Working dir cleanup failed: ${errorToMessage(cleanupErr)}`, task.id);
    }
    const phaseInfo = taskErr.phase ? ` [${taskErr.phase}]` : "";
    this.log(run.id, "engine", "error", `Task failed (${taskErr.category})${phaseInfo}: ${taskErr.message}`, task.id);
    this.store.updateTask(run.id, task.id, {
      status: "failed",
      errorMessage: `${taskErr.category}${phaseInfo}: ${taskErr.message}`.substring(0, 500),
      completedAt: Date.now(),
    });
    this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "failed", reason: taskErr.message });
  }

  private async buildContext(_task: TaskDefinition, run: ExecutionRun, gitManager: GitManager): Promise<TaskContext> {
    const lastTenCommits = await gitManager.getLastNCommits(10).catch((err) => { console.warn("[executor] getCommits failed:", err instanceof Error ? err.message : err); return []; });
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
${run.goals.map((g, i) => `${i + 1}. ${sanitizePromptInput(g)}`).join("\n")}

TERMINATION CONDITIONS:
${run.terminationConditions.map((c, i) => `${i + 1}. ${sanitizePromptInput(c)}`).join("\n")}

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
      const parsed = JSON.parse(extractJson(result.result));
      if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid evaluation result");

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

      // Token tracking (approximate from CC result)
      if (result.totalCostUsd > 0) {
        const estimatedTokens = Math.round((result.totalCostUsd / 0.003) * 1000);
        run.goalTokensUsed = (run.goalTokensUsed ?? 0) + estimatedTokens;
      }

      this.store.saveRun(run);
      this.broadcast("goal.updated", { runId: run.id, goal: serializeGoalState(run) });

      return {
        isComplete: parsed.isComplete ?? false,
        progressReport: parsed.progressReport ?? "",
        completedGoals: parsed.completedGoals ?? [],
        remainingGoals: parsed.remainingGoals ?? run.goals,
        overallProgress: parsed.overallProgress ?? 0,
      } as GoalEvaluation;
    } catch (parseErr) {
      console.warn("[executor] failed to parse goal evaluation result:", errorToMessage(parseErr));
      run.goalEvaluationCycles = evaluationCycles;
      run.goalLastEvalReason = "Evaluation parse failed";
      this.store.saveRun(run);
      return { isComplete: false, progressReport: "Evaluation parse failed", completedGoals: [], remainingGoals: run.goals, overallProgress: 0 };
    }
  }

  private async scoreTask(task: TaskDefinition, result: string, run: ExecutionRun): Promise<ScoreDetails> {
    const scoreResult = await this.ccClient.executeTask(
      `Score this task result against goals. Be strict.\nTask: ${sanitizePromptInput(task.content)}\nResult: ${result.substring(0, 2000)}\nGoals:\n${run.goals.map((g, i) => `${i + 1}. ${sanitizePromptInput(g)}`).join("\n")}\nRespond ONLY with JSON:\n{ "goalAlignment": 0_to_0.3, "correctness": 0_to_0.3, "completeness": 0_to_0.2, "quality": 0_to_0.2, "reasoning": "brief explanation" }`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 5, allowedTools: ["Read", "Glob", "Grep", "Bash"] },
    );
    try {
      const parsed = JSON.parse(extractJson(scoreResult.result));
      if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid score result");
      const overall = (parsed.goalAlignment || 0) + (parsed.correctness || 0) + (parsed.completeness || 0) + (parsed.quality || 0);
      return { ...parsed, overall, passed: overall >= this.config.qualityThreshold } as ScoreDetails;
    } catch (scoreErr) {
      console.warn("[executor] failed to parse score result:", errorToMessage(scoreErr));
      return { overall: 0, goalAlignment: 0, correctness: 0, completeness: 0, quality: 0, passed: false, reasoning: "Failed to parse score" };
    }
  }

  private async generateSmartTasks(run: ExecutionRun, evaluation: GoalEvaluation): Promise<Array<{ content: string; priority: number; reasoning: string }>> {
    const lessons = this.store.getLessons(run.id, "failure").slice(-5);
    const lessonStr = lessons.length > 0 ? `\n\nLessons from failures:\n${lessons.map((l) => `- ${l.lesson}`).join("\n")}` : "";
    const result = await this.ccClient.executeTask(
      `Generate next tasks for this project.\nGoals:\n${run.goals.map((g, i) => `${i + 1}. ${sanitizePromptInput(g)}`).join("\n")}\nRemaining:\n${evaluation.remainingGoals.map((g, i) => `${i + 1}. ${sanitizePromptInput(g)}`).join("\n")}\nProgress: ${evaluation.progressReport}${lessonStr}\nGenerate 1-3 tasks. Respond ONLY with JSON array:\n[{ "content": "task description", "priority": 1_to_10, "reasoning": "why" }]`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 10, allowedTools: ["Read", "Glob", "Grep", "Bash"] },
    );
    try {
      const tasks = JSON.parse(extractJson(result.result));
      if (!Array.isArray(tasks)) throw new Error("Expected task array from CC");
      return tasks;
    } catch (genErr) {
      console.warn("[executor] failed to parse smart task generation result:", errorToMessage(genErr));
      return [{ content: `Work on: ${evaluation.remainingGoals[0] || "project goals"}`, priority: 5, reasoning: "Fallback task" }];
    }
  }

  private async generateReport(run: ExecutionRun): Promise<string> {
    const tasks = this.store.listTasks(run.id);
    const commits = this.store.getCommits(run.id);
    const cost = this.recalculateCost(run.id);
    const result = await this.ccClient.executeTask(
      `Generate a final summary report.\nGoals:\n${run.goals.map((g, i) => `${i + 1}. ${sanitizePromptInput(g)}`).join("\n")}\nTasks completed: ${tasks.filter((t) => t.status === "completed").length}\nReverted: ${tasks.filter((t) => t.status === "reverted").length}\nCommits: ${commits.length}\nCost: $${cost.toFixed(4)}\nProvide a concise summary.`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 10, allowedTools: ["Read", "Glob", "Grep", "Bash"] },
    );
    return result.result;
  }

  private log(runId: string, source: string, level: string, message: string, taskId?: string): void {
    const entry = { timestamp: Date.now(), level, source, message, taskId: taskId || "", runId };
    this.store.appendLog(runId, entry);
    this.broadcast("log.entry", entry);
  }

  private broadcast(method: string, params: Record<string, unknown>): void {
    this.notify(method, params);
  }

  isRunning(): boolean {
    return this.running;
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
    const controllers = new Map(this.abortControllers);
    this.abortControllers.clear();
    for (const [id, controller] of controllers) {
      controller.abort();
      this.store.updateTask(this.runId, id, { status: "cancelled", completedAt: Date.now() });
    }
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
      this.log(run.id, "engine", "warn", `Approval wait interrupted: ${errorToMessage(err)}`);
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
Goals: ${run.goals.map(g => sanitizePromptInput(g)).join("; ")}
Termination conditions: ${run.terminationConditions.map(c => sanitizePromptInput(c)).join("; ")}

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
      this.log(run.id, "engine", "warn", `Feature generation failed (non-fatal): ${errorToMessage(err)}`);
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
      this.log(run.id, "engine", "warn", `Feature verification failed (non-fatal): ${errorToMessage(err)}`);
    }
  }
}
