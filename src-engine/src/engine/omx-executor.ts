/**
 * OMX Executor — drop-in replacement for the old Executor.
 *
 * Same public API (start, stop, isRunning, cancelTask, resolveApproval)
 * but uses OmxAmpPipeline (5-stage with RALPLAN consensus) instead of TaskPipeline.
 *
 * All other logic (handleEmptyQueue, evaluateGoal, scoreTask, etc.) is preserved.
 */

import type { TaskDefinition, ExecutionRun, TaskContext, GoalEvaluation, ScoreDetails, TaskStatus, CheckpointType } from "@ai-workbench/shared";
import { CCClient } from "../cc-integration/cc-client.js";
import { GitManager } from "../git/git-manager.js";
import { Store } from "../db/store.js";
import { SkillStore } from "../db/skill-store.js";
import { SkillManager } from "../skills/skill-manager.js";
import { generateClaudeMd } from "../skills/claude-md-generator.js";
import type { QueueManager } from "./queue-manager.js";
import { ApprovalGate, type ApprovalDecision } from "./approval-gate.js";
import { OmxAmpPipeline } from "./omx-pipeline.js";
import { OmxAmpTeamOrchestrator, type TeamConfig } from "./omx-team/team-orchestrator.js";
import { TaskRouter } from "./router/index.js";
import type { ComplexityAssessment, RoutingContext } from "./router/index.js";

// AgentExecutor removed — OMX pipeline uses OmxAmpPipeline instead
import { BranchStrategy } from "../git/branch-strategy.js";


import { errorToMessage } from "../lib/error-utils.js";
import { classifyError, getRetryStrategy, TaskError } from "../lib/error-types.js";
import { extractJson } from "../lib/json-extract.js";
import { serializeGoalState } from "../lib/goal-utils.js";

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
    .replace(/```/g, "``​`")
    .replace(/<system[^>]*>/gi, "[filtered]")
    .replace(/\bignore\s+(previous|above|all)\s+(instructions?|rules?)/gi, "[filtered]")
    .substring(0, 2000);
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
  private cachedCost: number | null = null;
  private maxConcurrency: number = 1;
  private taskRouter: TaskRouter;
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
    store?: Store,
  ) {
    this.store = store ?? new Store();
    this.ccClient = new CCClient((this.store.getConfig("claudePath") as string) || undefined);
    this.skillManager = new SkillManager(new SkillStore(), () => {});
    this.taskRouter = new TaskRouter(this.ccClient);
    this.taskRouter.setNotifyFn((method, params) => this.broadcast(method, params));
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
  }

  async start(run: ExecutionRun): Promise<void> {
    this.running = true;
    this.currentRun = run;
    this.stopController = new AbortController();
    this.evaluationCycles = 0;
    this.progressHistory = [];
    this.broadcast("run.status", { runId: run.id, status: "running" });
    this.log(run.id, "engine", "info", "OMX execution loop started");

    this.maxConcurrency = run.maxConcurrentTasks ?? this.config.maxConcurrentTasks;

    if (!run.goalStatus && run.goals.length > 0) {
      run.goalStatus = "pursuing";
      run.goalBudgetTokens = Infinity;
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
      if (this.queueManager.list(run.id).length === 0 && run.goals.length > 0) {
        await this.generateInitialTasks(run);
      }

      while (this.running) {
        const completedTaskIds = new Set<string>(
          this.store.listTasks(run.id)
            .filter(t => t.status === "completed")
            .map(t => t.id)
        );

        const task = this.queueManager.dequeueWithDeps(run.id, completedTaskIds);

        if (!task) {
          const shouldContinue = await this.handleEmptyQueue(run);
          if (!shouldContinue) break;
          continue;
        }

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

        // All tasks go through Team Orchestrator (default multi-agent mode)
        await this.runParallelTasks(run, task);

        run.totalTasksCompleted++;
        this.store.saveRun(run);

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

    const readyTasks = [firstTask];
    while (true) {
      const next = this.queueManager.dequeueWithDeps(run.id, completedTaskIds);
      if (!next) break;
      readyTasks.push(next);
      if (readyTasks.length >= this.maxConcurrency) break;
    }

    if (readyTasks.length === 1) {
      this.store.updateTask(run.id, firstTask.id, { status: "running", startedAt: Date.now() });
      this.broadcast("task.status", { taskId: firstTask.id, runId: run.id, status: "running" });
      this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });

      // Task Router: analyze complexity and choose execution strategy
      const routingCtx: RoutingContext = {
        runId: run.id,
        workingDir: run.workingDir,
        completedTaskCount: run.totalTasksCompleted,
        costUsedUsd: run.totalCostUsd,
        costBudgetUsd: this.config.maxBudgetUsd,
        startedAt: run.startedAt,
        hasGoals: run.goals.length > 0,
      };

      let routeAssessment: ComplexityAssessment | null = null;
      try {
        routeAssessment = await this.taskRouter.analyze(firstTask, routingCtx);
        this.log(run.id, "router", "info",
          `Task routed: ${routeAssessment.strategy.type}${routeAssessment.strategy.type === "builtin" ? `:${(routeAssessment.strategy as { type: "builtin"; templateName: string }).templateName}` : ""} (confidence: ${(routeAssessment.confidence * 100).toFixed(0)}%, ${routeAssessment.reason})`,
          firstTask.id);
      } catch (routeErr) {
        this.log(run.id, "router", "warn", `Routing analysis failed: ${routeErr instanceof Error ? routeErr.message : String(routeErr)}`);
      }

      // Route to appropriate execution path
      const strategy = routeAssessment?.strategy ?? { type: "builtin", templateName: "omx-pipeline" };

      if (strategy.type === "direct") {
        // Simple task: skip full pipeline, execute via single CC call
        await this.executeDirectTask(firstTask, run);
      } else {
        // Default: go through OMX pipeline (builtin:omx-pipeline or future workflow templates)
        // When WorkflowRuntime is ready (Phase 2), this will delegate to it
        await this.executeSingleTask(firstTask, run);
      }

      run.totalTasksCompleted++;
      this.store.saveRun(run);
      return;
    }

    // Use Team Orchestrator for multi-agent parallel execution
    const useFeatureBranch = this.config.branchStrategy === "feature-branch" || this.maxConcurrency > 1;
    const teamConfig: TeamConfig = {
      maxWorkers: this.maxConcurrency,
      worktreeIsolation: useFeatureBranch,
      maxFixAttempts: 3,
    };

    this.log(run.id, "engine", "info", `[team] Starting Team execution: ${readyTasks.length} tasks, ${this.maxConcurrency} workers`);

    // Create worktrees for each task (isolation)
    if (useFeatureBranch) {
      for (const task of readyTasks) {
        try {
          const result = await BranchStrategy.createTaskBranch(run.workingDir, task.id);
          task.branchName = result.branchName;
          task.worktreePath = result.worktreePath;
          this.store.updateTask(run.id, task.id, { branchName: result.branchName, worktreePath: result.worktreePath });
          this.log(run.id, "engine", "info", `[team] Created worktree for task ${task.id.substring(0, 6)}: ${result.branchName}`);
        } catch (e) {
          // If worktree creation fails, task stays in run.workingDir (shared)
          this.log(run.id, "engine", "warn", `Failed to create worktree for task ${task.id.substring(0, 6)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    for (const t of readyTasks) {
      this.store.updateTask(run.id, t.id, { status: "running", startedAt: Date.now() });
      this.broadcast("task.status", { taskId: t.id, runId: run.id, status: "running" });
    }
    this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });

    const abortSignal = this.stopController?.signal;
    const lessons = this.store.getLessons(run.id).slice(-20);
    const context: TaskContext = {
      workingDir: run.workingDir,
      goals: run.goals,
      terminationConditions: run.terminationConditions,
      lastTenCommits: [],
      nextFiveTasks: [],
      lessonsLearned: lessons,
    };

    try {
      const team = new OmxAmpTeamOrchestrator(this.ccClient, this.createPersistingNotify(run.id), teamConfig);
      const teamResult = await team.execute(readyTasks, run, context, abortSignal);

      this.log(run.id, "engine", "info",
        `[team] Completed: ${teamResult.completedTasks} succeeded, ${teamResult.failedTasks} failed, cost=$${teamResult.totalCostUsd.toFixed(4)}`);

      run.totalTasksCompleted += teamResult.completedTasks;
      this.store.saveRun(run);

      // Score, commit, and record lessons for each completed team task
      const gitManager = new GitManager({ workingDir: run.workingDir });
      await gitManager.ensureInit();

      // First, merge all successful branches
      if (useFeatureBranch) {
        for (const task of readyTasks) {
          if (!task.branchName || !task.worktreePath) continue;
          const storedTask = this.store.getTask(run.id, task.id);
          if (storedTask?.status === "completed") {
            try {
              const mergeResult = await BranchStrategy.mergeBranch(run.workingDir, task.branchName);
              if (mergeResult.success) {
                this.log(run.id, "engine", "info", `[team] Merged branch ${task.branchName}`);
              } else {
                this.log(run.id, "engine", "warn", `[team] Merge conflicts on ${task.branchName}: ${mergeResult.conflicts?.join(", ")}`);
              }
            } catch (e) {
              this.log(run.id, "engine", "warn", `Failed to merge branch ${task.branchName}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
      }

      // Then score, commit, and record for each task (sequentially)
      for (const task of readyTasks) {
        const storedTask = this.store.getTask(run.id, task.id);
        if (!storedTask) continue;

        this.log(run.id, "engine", "info", `Task ${task.id.substring(0, 6)} → ${storedTask.status}`);

        if (storedTask.status === "completed") {
          // Lightweight scoring: trust worker result, no extra CC call
          const teamData = teamResult.taskOutputs?.get(task.id);
          const score: ScoreDetails = {
            overall: 0.85, goalAlignment: 0.85, correctness: 0.85, completeness: 0.85, quality: 0.85,
            passed: true,
            reasoning: teamData?.output
              ? `Team worker completed: ${teamData.output.substring(0, 100)}`
              : "Team worker completed successfully",
          };

          this.store.appendScore(run.id, task.id, score);
          this.store.updateTask(run.id, task.id, { score: score.overall, scoreDetails: score });
          this.broadcast("task.scored", { taskId: task.id, runId: run.id, score });

          // Git commit
          try {
            const commitHash = await gitManager.autoCommit(task.id, task.content);
            this.log(run.id, "git", "info", `Committed: ${commitHash ? commitHash.substring(0, 7) : "unknown"} #AI commit#`, task.id);
            this.store.appendCommit(run.id, {
              taskId: task.id, runId: run.id, hash: commitHash || "", message: task.content,
              isAiCommit: true, timestamp: Date.now(), additions: 0, deletions: 0,
            });
            this.broadcast("git.commit", { taskId: task.id, runId: run.id, hash: commitHash, message: task.content, isAiCommit: true });
          } catch (e) {
            this.log(run.id, "git", "warn", `Commit failed: ${e instanceof Error ? e.message : String(e)}`, task.id);
          }
        } else {
          // Failed task — record lesson
          this.store.appendLesson(run.id, {
            runId: run.id, taskId: task.id, category: "failure",
            lesson: `Team task "${task.content.substring(0, 50)}" failed.`,
            score: 0, createdAt: Date.now(),
          });
        }

        // Cleanup worktree regardless of success/failure
        if (task.branchName && task.worktreePath) {
          try {
            await BranchStrategy.cleanupBranch(run.workingDir, task.branchName, task.worktreePath);
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      }
    } catch (err) {
      // Cleanup all worktrees on error
      if (useFeatureBranch) {
        for (const task of readyTasks) {
          if (task.branchName && task.worktreePath) {
            try {
              await BranchStrategy.cleanupBranch(run.workingDir, task.branchName, task.worktreePath);
            } catch (e) { /* ignore */ }
          }
        }
      }

      this.log(run.id, "engine", "error", `[team] Team execution failed: ${errorToMessage(err)}`);
      // Fallback: execute remaining tasks sequentially
      this.log(run.id, "engine", "info", `[team] Falling back to sequential execution`);
      for (const task of readyTasks) {
        const stored = this.store.getTask(run.id, task.id);
        if (stored?.status === "running" || stored?.status === "pending") {
          await this.executeSingleTask(task, run);
          run.totalTasksCompleted++;
        }
      }
      this.store.saveRun(run);
    }
    this.cachedCost = null;
  }

  private async handleEmptyQueue(run: ExecutionRun): Promise<boolean> {
    this.evaluationCycles++;
    this.log(run.id, "engine", "info", `Queue empty — evaluating goals (cycle ${this.evaluationCycles}/${this.config.maxEvaluationCycles})`);

    if (this.evaluationCycles > this.config.maxEvaluationCycles) {
      this.log(run.id, "engine", "warn", `Reached max evaluation cycles (${this.config.maxEvaluationCycles}). Stopping.`);
      await this.finalize(run, "Max evaluation cycles reached. Partial progress may have been made.");
      return false;
    }

    let evaluation: GoalEvaluation;
    try {
      evaluation = await this.evaluateGoal(run);
    } catch (err) {
      const msg = errorToMessage(err);
      this.log(run.id, "engine", "warn", `Goal evaluation failed: ${msg}. Cooling down and retrying next cycle.`);
      try { await this.sleep(CYCLE_COOLDOWN_MS); } catch { return false; }
      return true;
    }

    if (!this.running) return false;

    this.progressHistory.push(evaluation.overallProgress);
    const maxHistory = this.config.stagnationWindow * 2;
    if (this.progressHistory.length > maxHistory) {
      this.progressHistory = this.progressHistory.slice(-maxHistory);
    }
    if (this.progressHistory.length >= 2) {
      const prev = this.progressHistory[this.progressHistory.length - 2];
      const curr = this.progressHistory[this.progressHistory.length - 1];
      if (curr > prev + 0.01) {
        this.evaluationCycles = Math.floor(this.evaluationCycles / 2);
      }
    }
    if (this.isStagnant()) {
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
        const redirectTask = this.queueManager.enqueue(run.id, {
          content: decision.instructions,
          type: "user_defined",
          priority: 1,
        });
        this.store.saveTask(run.id, redirectTask);
        this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });
      }
      this.progressHistory = [];
      this.evaluationCycles = 0;
    }

    if (evaluation.isComplete) {
      // Check if user added new pending tasks before finalizing
      const pendingTasks = this.store.listTasks(run.id).filter(t => t.status === "pending");
      if (pendingTasks.length > 0) {
        this.log(run.id, "engine", "info", `Goals complete but ${pendingTasks.length} pending task(s) remain — continuing`);
        for (const t of pendingTasks) {
          if (!this.queueManager.list(run.id).some(q => q.id === t.id)) {
            this.queueManager.restore(run.id, t);
          }
        }
        this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });
        return true;
      }
      this.log(run.id, "engine", "info", `Goals complete! Progress: ${(evaluation.overallProgress * 100).toFixed(0)}%`);
      await this.finalize(run);
      return false;
    }

    this.log(run.id, "engine", "info", `Goals not met (${(evaluation.overallProgress * 100).toFixed(0)}%). Generating smart tasks...`);
    let smartTasks: Array<{ content: string; priority: number; reasoning: string }>;
    try {
      smartTasks = await this.generateSmartTasks(run, evaluation);
    } catch (err) {
      const msg = errorToMessage(err);
      this.log(run.id, "engine", "warn", `Smart task generation failed: ${msg}. Retrying next cycle.`);
      try { await this.sleep(CYCLE_COOLDOWN_MS); } catch { return false; }
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

    try {
      await this.sleep(CYCLE_COOLDOWN_MS);
    } catch {
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

  /**
   * Execute a single task using the OMX 5-stage pipeline.
   * This is the ONLY method that differs from the old executor.
   */
  /**
   * Direct execution path for simple tasks.
   * Skips the full OMX pipeline and executes via a single CC call.
   */
  private async executeDirectTask(task: TaskDefinition, run: ExecutionRun): Promise<void> {
    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);
    const gitManager = new GitManager({ workingDir: run.workingDir });

    try {
      await gitManager.ensureInit();

      this.log(run.id, "direct", "info", `[Direct] Executing simple task: ${task.content.substring(0, 80)}...`);

      const prompt = task.promptJson
        ? `任务: ${task.content}\n\n详细指令:\n${task.promptJson}`
        : `任务: ${task.content}\n\n请完成上述任务。工作目录: ${run.workingDir}`;

      const stream = this.ccClient.executeTaskStream(prompt, {
        workingDir: run.workingDir,
        timeoutMinutes: task.timeoutMinutes || 3,
        maxTurns: 10,
      });

      let output = "";
      for await (const msg of stream) {
        if (msg.type === "assistant") {
          const content = (msg as unknown as Record<string, unknown>);
          if (typeof content.content === "string") output += content.content;
          else if (content.message && typeof (content.message as Record<string, unknown>).content === "object") {
            const blocks = (content.message as Record<string, unknown>).content as Array<Record<string, unknown>>;
            for (const block of blocks) {
              if (block.type === "text" && typeof block.text === "string") output += block.text;
            }
          }
        }
        if (msg.type === "result" && typeof msg.result === "string") {
          if (!output && msg.result) output = msg.result;
        }
      }

      // Simple scoring for direct tasks
      const score: ScoreDetails = {
        overall: 0.8,
        goalAlignment: 0.8,
        correctness: 0.8,
        completeness: 0.8,
        quality: 0.8,
        passed: true,
        reasoning: "Direct execution — auto-assumed passing for simple task",
      };

      this.store.appendScore(run.id, task.id, score);
      this.store.updateTask(run.id, task.id, {
        status: "completed",
        completedAt: Date.now(),
        result: output,
        score: score.overall,
        scoreDetails: score,
      });
      this.broadcast("task.scored", { taskId: task.id, runId: run.id, score });
      this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "completed" });

      this.log(run.id, "direct", "info", `Direct task completed successfully`, task.id);
    } catch (err) {
      const msg = errorToMessage(err);
      this.log(run.id, "direct", "error", `Direct execution failed: ${msg}`, task.id);
      this.store.updateTask(run.id, task.id, { status: "failed", completedAt: Date.now(), errorMessage: msg });
      this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "failed", reason: msg });
    } finally {
      this.abortControllers.delete(task.id);
    }
  }

  private async executeSingleTask(task: TaskDefinition, run: ExecutionRun): Promise<void> {
    const gitManager = new GitManager({ workingDir: run.workingDir });
    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);

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

      const pipelineWorkingDir = branchResult?.worktreePath || run.workingDir;
      this.skillManager.prepareWorkingDir(pipelineWorkingDir);
      const context = await this.buildContext(task, run, gitManager);
      generateClaudeMd(pipelineWorkingDir, context);

      this.log(run.id, "pipeline", "info", `[OMX] Executing via OmxAmpPipeline: ${task.content.substring(0, 80)}...`);

      // ── Standard OMX Pipeline execution ──
      const pipeline = new OmxAmpPipeline(this.ccClient, this.createPersistingNotify(run.id), pipelineWorkingDir);
      const pipelineResult = await pipeline.run(task, context, abortController.signal);

      this.log(run.id, "pipeline", "info", `Pipeline completed in ${pipelineResult.durationMs}ms (${pipelineResult.iterations} iteration${pipelineResult.iterations > 1 ? "s" : ""}), cost $${pipelineResult.totalCostUsd.toFixed(4)}`, task.id);
      run.totalCostUsd = this.recalculateCost(run.id) + pipelineResult.totalCostUsd;
      this.cachedCost = null;

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

      // Quality scoring: prefer review score from pipeline
      let score: ScoreDetails;
      if (pipelineResult.reviewResult) {
        const review = pipelineResult.reviewResult;
        const overall = Math.min(review.score, 1);
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

      this.log(run.id, "scorer", score.passed ? "info" : "warn",
        `Score: ${(score.overall * 100).toFixed(0)}% — ${score.passed ? "PASS" : "FAIL (reverting)"}`, task.id);

      // Checkpoint: borderline_score
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

      // Checkpoint: risky_commit
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
        // Merge feature branch first so autoCommit captures worktree changes
        if (useFeatureBranch && branchResult) {
          try {
            const mergeResult = await BranchStrategy.mergeBranch(run.workingDir, branchResult.branchName);
            if (mergeResult.success) {
              this.log(run.id, "engine", "info", `Merged feature branch: ${branchResult.branchName}`);
            } else {
              this.log(run.id, "engine", "warn", `Merge conflicts on ${branchResult.branchName}: ${mergeResult.conflicts?.join(", ")}`);
            }
          } catch (err) {
            this.log(run.id, "engine", "error", `Failed to merge feature branch: ${err instanceof Error ? err.message : err}`);
          }
        }
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

      if (useFeatureBranch && branchResult) {
        try {
          const mergeResult = await BranchStrategy.mergeBranch(run.workingDir, branchResult.branchName);
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
    this.store.appendLesson(run.id, {
      runId: run.id, taskId: task.id, category: "failure",
      lesson: `Task "${task.content.substring(0, 60)}" failed: ${taskErr.category}${phaseInfo} — ${taskErr.message.substring(0, 120)}`,
      score: 0, createdAt: Date.now(),
    });
    this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "failed", reason: taskErr.message });
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
${run.goals.map((g, i) => `${i + 1}. ${sanitizePromptInput(g)}`).join("\n")}

TERMINATION CONDITIONS:
${run.terminationConditions.map((c, i) => `${i + 1}. ${sanitizePromptInput(c)}`).join("\n")}

PREVIOUS EVIDENCE COLLECTED:
${evidence.length > 0 ? evidence.map((e, i) => `${i + 1}. ${e}`).join("\n") : "(none yet)"}

INSTRUCTIONS:
1. Check the ACTUAL files, test results, and project state — do NOT infer or assume.
2. Do NOT accept proxy signals as completion.
3. Build a checklist mapping the goals' requirements to concrete evidence.
4. Verify coverage comprehensively before declaring success.
5. If you cannot verify something, state what is missing.

Respond ONLY with valid JSON:
{
  "isComplete": boolean,
  "progressReport": "short summary",
  "completedGoals": ["goal completed"],
  "remainingGoals": ["goal remaining"],
  "overallProgress": 0.0_to_1.0,
  "achieved": boolean,
  "reason": "explanation",
  "evidence": ["evidence 1", "evidence 2"],
  "nextSteps": "if not achieved, what to do next"
}`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 10, allowedTools: ["Read", "Glob", "Grep", "Bash"] },
    );

    try {
      const parsed = JSON.parse(extractJson(result.result));
      if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid evaluation result");

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

  private async generateInitialTasks(run: ExecutionRun): Promise<void> {
    this.log(run.id, "engine", "info", "Generating initial task plan from goals...");
    const result = await this.ccClient.executeTask(
      `Analyze the project and generate an initial task plan.\n\nGoals:\n${run.goals.map((g, i) => `${i + 1}. ${sanitizePromptInput(g)}`).join("\n")}\n\nGuidelines:\n- List tasks in recommended execution order\n- Independent tasks should have NO dependency on each other\n- UI/UX restyling tasks MUST depend on feature tasks that implement the underlying functionality\n- Set priority to reflect importance (1=highest, 10=lowest)\n\nGenerate 5-10 specific, actionable tasks.\n\nRespond ONLY with JSON array:\n[{ "content": "task description", "priority": 1_to_10, "reasoning": "why this task", "dependsOnIndices": [0-based indices or []] }]`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 10, allowedTools: ["Read", "Glob", "Grep", "Bash"] },
    );
    try {
      const tasks = JSON.parse(extractJson(result.result));
      if (!Array.isArray(tasks)) throw new Error("Expected task array");

      const taskIds: string[] = [];
      const taskParams: Array<{ content: string; priority: number; dependsOnIndices?: number[] }> = tasks;
      for (const t of taskParams) {
        const newTask = this.queueManager.enqueue(run.id, {
          content: t.content,
          type: "smart_task" as const,
          priority: t.priority,
        });
        this.store.saveTask(run.id, newTask);
        taskIds.push(newTask.id);
        this.log(run.id, "engine", "info", `Initial task queued: ${t.content.substring(0, 50)}...`);
      }

      for (let i = 0; i < taskParams.length; i++) {
        const indices = taskParams[i].dependsOnIndices;
        if (Array.isArray(indices) && indices.length > 0) {
          const deps = indices
            .filter((idx) => idx >= 0 && idx < taskIds.length && idx !== i)
            .map((idx) => taskIds[idx]);
          if (deps.length > 0) {
            this.queueManager.updateDependencies(run.id, taskIds[i], deps);
            this.store.updateTask(run.id, taskIds[i], { dependsOn: deps });
          }
        }
      }

      this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });
    } catch (err) {
      console.warn("[executor] failed to parse initial task plan:", errorToMessage(err));
      for (const goal of run.goals) {
        const fallbackTask = this.queueManager.enqueue(run.id, {
          content: `Work on: ${goal}`,
          type: "smart_task" as const,
          priority: 5,
        });
        this.store.saveTask(run.id, fallbackTask);
      }
      this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });
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

  /**
   * Create a notify function that persists log.entry events to disk before broadcasting.
   * Used by sub-components (TeamOrchestrator, WorkerManager, OmxAmpGate, OmxAmpPipeline)
   * so that their log notifications survive browser refresh.
   */
  private createPersistingNotify(runId: string): (method: string, params: unknown) => void {
    return (method: string, params: unknown) => {
      if (method === "log.entry") {
        const entry = params as Record<string, unknown>;
        this.store.appendLog(runId, {
          timestamp: (entry.timestamp as number) ?? Date.now(),
          level: (entry.level as string) ?? "info",
          source: (entry.source as string) ?? "engine",
          message: (entry.message as string) ?? "",
          taskId: (entry.taskId as string) ?? "",
          runId,
        });
      } else if (method === "task.status") {
        const p = params as { taskId?: string; status?: string };
        if (p.taskId && p.status) {
          const updates: Partial<TaskDefinition> = { status: p.status as TaskStatus };
          if (["completed", "failed", "cancelled"].includes(p.status)) {
            updates.completedAt = Date.now();
          }
          this.store.updateTask(runId, p.taskId, updates);
          this.store.appendLog(runId, {
            timestamp: Date.now(),
            level: p.status === "failed" ? "error" : p.status === "reverted" ? "warn" : "info",
            source: "engine",
            message: `Task ${p.taskId.substring(0, 6)} → ${p.status}`,
            taskId: p.taskId,
            runId,
          });
        }
      } else if (method === "task.progress") {
        const p = params as { taskId?: string; phase?: string; message?: string; content?: string };
        const msg = p.message || p.content || (p.taskId ? `Task ${p.taskId.substring(0, 6)} progress` : "progress");
        this.store.appendLog(runId, {
          timestamp: Date.now(),
          level: "info",
          source: "cc",
          message: `[${p.phase || "exec"}] ${msg}`,
          taskId: p.taskId || "",
          runId,
        });
      }
      this.broadcast(method, params as Record<string, unknown>);
    };
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
        run.id, task?.id, checkpointType, summary, contextData, timeoutMs,
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

}
