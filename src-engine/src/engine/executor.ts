import type { TaskDefinition, ExecutionRun, TaskContext, GoalEvaluation, ScoreDetails, TaskStatus } from "@ai-workbench/shared";
import { CCClient } from "../cc-integration/cc-client.js";
import { GitManager } from "../git/git-manager.js";
import { Store } from "../db/store.js";
import type { QueueManager } from "./queue-manager.js";

const DEFAULT_QUALITY_THRESHOLD = 0.6;
const DEFAULT_MAX_EVALUATION_CYCLES = 20;
const DEFAULT_MAX_BUDGET_USD = 50;
const DEFAULT_STAGNATION_WINDOW = 5;
const DEFAULT_MAX_TURNS = 50;
const CYCLE_COOLDOWN_MS = 10000;

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

export class Executor {
  private ccClient: CCClient;
  private store: Store;
  private abortControllers: Map<string, AbortController> = new Map();
  private running = false;
  private evaluationCycles = 0;
  private progressHistory: number[] = [];
  private stopController: AbortController | null = null;
  private config: {
    qualityThreshold: number;
    maxEvaluationCycles: number;
    maxBudgetUsd: number;
    stagnationWindow: number;
    maxTurns: number;
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
    };
    try {
      const keys = ["qualityThreshold", "maxEvaluationCycles", "maxBudgetUsd", "stagnationWindow", "maxTurns"] as const;
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
    this.stopController = new AbortController();
    this.evaluationCycles = 0;
    this.progressHistory = [];
    this.broadcast("run.status", { runId: run.id, status: "running" });
    this.log(run.id, "engine", "info", "Execution loop started");

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

      this.log(run.id, "cc", "info", `Executing: ${task.content.substring(0, 80)}... (${task.agentMode === "multi" ? "multi-agent" : "single-agent"})`, task.id);

      let result;

      if (task.agentMode === "multi") {
        // Multi-agent: run 2-3 parallel CC processes on subtasks, then merge
        const subtasks = await this.splitTaskForMultiAgent(task, run);
        const subResults = await Promise.all(
          subtasks.map((sub, idx) => {
            const subAbort = new AbortController();
            this.abortControllers.set(`${task.id}-sub-${idx}`, subAbort);
            return this.ccClient.executeTask(sub, {
              workingDir: run.workingDir,
              timeoutMinutes: Math.max(Math.floor(task.timeoutMinutes * 0.7), 10),
              maxTurns: Math.max(Math.floor(this.config.maxTurns / subtasks.length), 5),
              systemPrompt,
              abortSignal: subAbort.signal,
              allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
            }).finally(() => this.abortControllers.delete(`${task.id}-sub-${idx}`));
          })
        );

        // Merge results
        const totalCost = subResults.reduce((s, r) => s + r.totalCostUsd, 0);
        const totalDuration = subResults.reduce((s, r) => s + r.durationMs, 0);
        const mergedResult = subResults.map((r, i) => `--- Sub-task ${i + 1} ---\n${r.result}`).join("\n\n");
        result = {
          result: mergedResult,
          sessionId: subResults[0]?.sessionId || "",
          totalCostUsd: totalCost,
          durationMs: totalDuration,
          numTurns: subResults.reduce((s, r) => s + r.numTurns, 0),
          messages: subResults.flatMap((r) => r.messages),
        };
      } else {
        // Single-agent: standard execution
        result = await this.ccClient.executeTask(task.content, {
          workingDir: run.workingDir,
          sessionId: task.sessionId,
          timeoutMinutes: task.timeoutMinutes,
          maxTurns: this.config.maxTurns,
          systemPrompt,
          abortSignal: abortController.signal,
          allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        });
      }

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
        this.store.updateTask(run.id, task.id, { status: finalStatus, completedAt: Date.now() });
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: finalStatus });
      }
    } catch (err) {
      const msg = this.errorToMessage(err);
      this.log(run.id, "engine", "error", `Task failed: ${msg}`, task.id);
      this.store.updateTask(run.id, task.id, { status: "failed" });
      this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "failed", error: msg });
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

  private async splitTaskForMultiAgent(task: TaskDefinition, run: ExecutionRun): Promise<string[]> {
    try {
      const splitResult = await this.ccClient.executeTask(
        `Split this task into 2-3 independent subtasks that can be executed in parallel. Each subtask should focus on a different aspect.\nTask: ${task.content}\nGoals: ${run.goals.join(", ")}\nRespond ONLY with a JSON array of strings, each being a subtask description. No other text.`,
        { workingDir: run.workingDir, timeoutMinutes: 2, maxTurns: 3, allowedTools: ["Read", "Glob", "Grep"] },
      );
      const parsed = JSON.parse(this.extractJson(splitResult.result));
      if (Array.isArray(parsed) && parsed.length >= 2) {
        return parsed.map((s: unknown) => String(s));
      }
    } catch (splitErr) {
      console.warn("[executor] multi-agent task splitting failed, using original task:", splitErr instanceof Error ? splitErr.message : splitErr);
    }
    // Fallback: just use the original task as single subtask
    return [task.content];
  }

  private buildSystemPrompt(_task: TaskDefinition, context: TaskContext): string {
    const parts: string[] = [];
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
    const result = await this.ccClient.executeTask(
      `Evaluate whether the following goals have been achieved based on the current state of the project.\nGoals:\n${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}\nTermination conditions:\n${run.terminationConditions.map((c, i) => `${i + 1}. ${c}`).join("\n")}\nCheck the actual files. Respond ONLY with JSON:\n{ "isComplete": boolean, "progressReport": string, "completedGoals": string[], "remainingGoals": string[], "overallProgress": 0.0_to_1.0 }`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 10, allowedTools: ["Read", "Glob", "Grep", "Bash"] },
    );
    try {
      return JSON.parse(this.extractJson(result.result)) as GoalEvaluation;
    } catch (parseErr) {
      console.warn("[executor] failed to parse goal evaluation result:", parseErr instanceof Error ? parseErr.message : parseErr);
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
      return err.stack || err.message;
    }
    return String(err);
  }

  private broadcast(method: string, params: Record<string, unknown>): void {
    this.notify(method, params);
  }

  cancelTask(taskId: string, runId: string): void {
    const controller = this.abortControllers.get(taskId);
    if (controller) controller.abort();
    this.store.updateTask(runId, taskId, { status: "cancelled", completedAt: Date.now() });
  }

  stop(): void {
    this.running = false;
    this.stopController?.abort();
    for (const [id, controller] of this.abortControllers) {
      controller.abort();
      this.store.updateTask(this.runId, id, { status: "cancelled", completedAt: Date.now() });
    }
    this.abortControllers.clear();
  }
}
