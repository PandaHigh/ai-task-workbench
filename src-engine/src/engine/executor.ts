import type { TaskDefinition, ExecutionRun, TaskContext, GoalEvaluation, ScoreDetails } from "@ai-workbench/shared";
import { CCClient, CCTaskResult } from "../cc-integration/cc-client.js";
import { GitManager } from "../git/git-manager.js";
import { Store } from "../db/store.js";
import type { QueueManager } from "./queue-manager.js";

const QUALITY_THRESHOLD = 0.6;

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

export class Executor {
  private ccClient: CCClient;
  private store: Store;
  private abortControllers: Map<string, AbortController> = new Map();
  private running = false;

  constructor(
    private queueManager: QueueManager,
    private notify: NotifyFn,
  ) {
    this.ccClient = new CCClient();
    this.store = new Store();
  }

  async start(run: ExecutionRun): Promise<void> {
    this.running = true;
    this.broadcast("run.status", { runId: run.id, status: "running" });
    this.log(run.id, "engine", "info", "Execution loop started");

    try {
      while (this.running) {
        const task = this.queueManager.dequeue(run.id);

        if (!task) {
          this.log(run.id, "engine", "info", "Queue empty — evaluating goals");

          const evaluation = await this.evaluateGoal(run);

          if (evaluation.isComplete) {
            this.log(run.id, "engine", "info", `Goals complete! Progress: ${(evaluation.overallProgress * 100).toFixed(0)}%`);
            const report = await this.generateReport(run);
            run.status = "completed";
            run.completedAt = Date.now();
            run.finalReport = report;
            this.store.saveRun(run);
            this.store.saveReport(run.id, report);
            this.broadcast("run.status", { runId: run.id, status: "completed", report });
            break;
          }

          this.log(run.id, "engine", "info", `Goals not met (${(evaluation.overallProgress * 100).toFixed(0)}%). Generating smart tasks...`);
          const smartTasks = await this.generateSmartTasks(run, evaluation);

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
          continue;
        }

        // Execute task
        this.store.updateTask(run.id, task.id, { status: "running", startedAt: Date.now() });
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "running" });
        this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });

        const success = await this.executeSingleTask(task, run);

        run.totalTasksCompleted++;
        run.totalCostUsd += task.costUsd || 0;
        this.store.saveRun(run);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(run.id, "engine", "error", `Execution failed: ${msg}`);
      run.status = "failed";
      this.store.saveRun(run);
      this.broadcast("run.status", { runId: run.id, status: "failed", error: msg });
    }
  }

  private async executeSingleTask(task: TaskDefinition, run: ExecutionRun): Promise<boolean> {
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
        maxTurns: 50,
        systemPrompt,
        abortSignal: abortController.signal,
      });

      this.log(run.id, "cc", "info", `CC completed in ${result.durationMs}ms, cost $${result.totalCostUsd.toFixed(4)}`);

      this.store.updateTask(run.id, task.id, {
        status: "scoring",
        result: result.result,
        sessionId: result.sessionId,
        costUsd: result.totalCostUsd,
        durationMs: result.durationMs,
      });
      this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "scoring" });

      // Quality scoring
      const score = await this.scoreTask(task, result.result, run);
      this.store.appendScore(run.id, task.id, score);
      this.store.updateTask(run.id, task.id, { score: score.overall, scoreDetails: score });
      this.broadcast("task.scored", { taskId: task.id, runId: run.id, score });

      this.log(run.id, "scorer", score.passed ? "info" : "warn",
        `Score: ${(score.overall * 100).toFixed(0)}% — ${score.passed ? "PASS" : "FAIL (reverting)"}`);

      if (score.passed) {
        const commitHash = await gitManager.autoCommit(task.id, task.content);
        this.log(run.id, "git", "info", `Committed: ${commitHash.substring(0, 7)} #AI commit#`);
        this.store.appendCommit(run.id, {
          taskId: task.id,
          runId: run.id,
          hash: commitHash,
          message: task.content,
          isAiCommit: true,
          timestamp: Date.now(),
          additions: 0,
          deletions: 0,
        });
        this.broadcast("git.commit", { taskId: task.id, runId: run.id, hash: commitHash, message: task.content, isAiCommit: true });
        this.store.updateTask(run.id, task.id, { status: "completed", completedAt: Date.now() });
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "completed" });
        return true;
      } else {
        // Revert
        try {
          await gitManager.revert("HEAD");
          this.log(run.id, "git", "warn", "Reverted last commit (quality below threshold)");
        } catch (revertErr) {
          this.log(run.id, "git", "error", `Revert failed: ${revertErr}`);
        }
        this.store.appendLesson(run.id, {
          runId: run.id,
          taskId: task.id,
          category: "failure",
          lesson: `Task "${task.content.substring(0, 50)}" scored ${(score.overall * 100).toFixed(0)}%. Reason: ${score.reasoning}`,
          score: score.overall,
          createdAt: Date.now(),
        });
        this.store.updateTask(run.id, task.id, { status: "reverted", completedAt: Date.now() });
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "reverted" });
        return false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(run.id, "engine", "error", `Task failed: ${msg}`);
      this.store.updateTask(run.id, task.id, { status: "failed" });
      this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "failed", error: msg });
      return false;
    } finally {
      this.abortControllers.delete(task.id);
    }
  }

  private async buildContext(task: TaskDefinition, run: ExecutionRun, gitManager: GitManager): Promise<TaskContext> {
    const lastTenCommits = await gitManager.getLastNCommits(10);
    const nextFiveTasks = this.queueManager.peekNext(run.id, 5);
    const lessons = this.store.getLessons(run.id);

    return {
      workingDir: run.workingDir,
      goals: run.goals,
      terminationConditions: run.terminationConditions,
      lastTenCommits: lastTenCommits.map((c) => ({
        hash: c.hash,
        message: c.message,
        timestamp: new Date(c.date).getTime(),
        isAiCommit: c.isAiCommit,
      })),
      nextFiveTasks,
      lessonsLearned: lessons,
    };
  }

  private buildSystemPrompt(task: TaskDefinition, context: TaskContext): string {
    const parts: string[] = [];

    if (context.lastTenCommits.length > 0) {
      parts.push("Recent git commits:");
      for (const c of context.lastTenCommits) {
        parts.push(`  ${c.hash.substring(0, 7)} ${c.message}`);
      }
    }

    if (context.nextFiveTasks.length > 0) {
      parts.push("\nUpcoming tasks:");
      for (const t of context.nextFiveTasks) {
        parts.push(`  [${t.type}] ${t.content}`);
      }
    }

    if (context.lessonsLearned.length > 0) {
      parts.push("\nLessons from previous tasks:");
      for (const l of context.lessonsLearned.slice(-10)) {
        parts.push(`  [${l.category}] ${l.lesson}`);
      }
    }

    return parts.join("\n");
  }

  private async evaluateGoal(run: ExecutionRun): Promise<GoalEvaluation> {
    const result = await this.ccClient.executeTask(
      `Evaluate whether the following goals have been achieved based on the current state of the project in this directory.

Goals:
${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}

Termination conditions:
${run.terminationConditions.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Check the actual files in the directory. Respond ONLY with a JSON object:
{ "isComplete": boolean, "progressReport": string, "completedGoals": string[], "remainingGoals": string[], "overallProgress": 0.0_to_1.0 }`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 10 },
    );

    try {
      return JSON.parse(this.extractJson(result.result)) as GoalEvaluation;
    } catch {
      return { isComplete: false, progressReport: "Evaluation parse failed", completedGoals: [], remainingGoals: run.goals, overallProgress: 0 };
    }
  }

  private async scoreTask(task: TaskDefinition, result: string, run: ExecutionRun): Promise<ScoreDetails> {
    const scoreResult = await this.ccClient.executeTask(
      `Score this task result against the overall goals. Be strict and objective.

Task: ${task.content}
Result preview: ${result.substring(0, 2000)}

Goals:
${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}

Respond ONLY with a JSON object:
{ "goalAlignment": 0_to_0.3, "correctness": 0_to_0.3, "completeness": 0_to_0.2, "quality": 0_to_0.2, "reasoning": "brief explanation" }`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 5 },
    );

    try {
      const parsed = JSON.parse(this.extractJson(scoreResult.result));
      const overall = (parsed.goalAlignment || 0) + (parsed.correctness || 0) + (parsed.completeness || 0) + (parsed.quality || 0);
      return { ...parsed, overall, passed: overall >= QUALITY_THRESHOLD } as ScoreDetails;
    } catch {
      return { overall: 0, goalAlignment: 0, correctness: 0, completeness: 0, quality: 0, passed: false, reasoning: "Failed to parse score" };
    }
  }

  private async generateSmartTasks(run: ExecutionRun, evaluation: GoalEvaluation): Promise<Array<{ content: string; priority: number; reasoning: string }>> {
    const lessons = this.store.getLessons(run.id, "failure");
    const lessonStr = lessons.length > 0
      ? `\n\nLessons from failures (AVOID these):\n${lessons.slice(-5).map((l) => `- ${l.lesson}`).join("\n")}`
      : "";

    const result = await this.ccClient.executeTask(
      `Based on the current state of this project, generate the next tasks to work on.

Goals:
${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}

Remaining:
${evaluation.remainingGoals.map((g, i) => `${i + 1}. ${g}`).join("\n")}

Progress: ${evaluation.progressReport}${lessonStr}

Generate 1-3 focused tasks. Respond ONLY with a JSON array:
[{ "content": "specific task description", "priority": 1_to_10, "reasoning": "why this task" }]`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 10 },
    );

    try {
      return JSON.parse(this.extractJson(result.result));
    } catch {
      return [{ content: `Work on: ${evaluation.remainingGoals[0] || "project goals"}`, priority: 5, reasoning: "Fallback task" }];
    }
  }

  private async generateReport(run: ExecutionRun): Promise<string> {
    const tasks = this.store.listTasks(run.id);
    const scores = this.store.getScores(run.id);
    const commits = this.store.getCommits(run.id);

    const result = await this.ccClient.executeTask(
      `Generate a final summary report for this completed AI task run.

Goals:
${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}

Tasks completed: ${tasks.filter((t) => t.status === "completed").length}
Tasks reverted: ${tasks.filter((t) => t.status === "reverted").length}
Total commits: ${commits.length}
Total cost: $${run.totalCostUsd.toFixed(4)}

Provide a concise summary of what was accomplished, what worked well, and any recommendations.`,
      { workingDir: run.workingDir, timeoutMinutes: 5, maxTurns: 10 },
    );
    return result.result;
  }

  private extractJson(text: string): string {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    return match ? match[0] : text;
  }

  private log(runId: string, source: string, level: string, message: string): void {
    const entry = { timestamp: Date.now(), level, source, message, taskId: "", runId };
    this.store.appendLog(runId, entry);
    this.broadcast("log.entry", entry);
  }

  private broadcast(method: string, params: Record<string, unknown>): void {
    this.notify(method, params);
  }

  cancelTask(taskId: string): void {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.log("", "engine", "warn", `Task ${taskId} cancelled`);
    }
  }

  stop(): void {
    this.running = false;
  }
}
