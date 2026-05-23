import type { TaskDefinition, ExecutionRun, TaskContext, GoalEvaluation, ScoreDetails } from "@ai-workbench/shared";
import { CCClient } from "../cc-integration/cc-client.js";
import { GitManager } from "../git/git-manager.js";
import type { QueueManager } from "./queue-manager.js";

const QUALITY_THRESHOLD = 0.6;

export class Executor {
  private ccClient: CCClient;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(
    private queueManager: QueueManager,
    private notify: (method: string, params: Record<string, unknown>) => void,
  ) {
    this.ccClient = new CCClient();
  }

  async start(run: ExecutionRun): Promise<void> {
    this.notify("run.status", { runId: run.id, status: "running" });

    try {
      while (true) {
        const task = this.queueManager.dequeue(run.id);

        if (!task) {
          const evaluation = await this.evaluateGoal(run);

          if (evaluation.isComplete) {
            const report = await this.generateReport(run);
            this.notify("run.status", {
              runId: run.id,
              status: "completed",
              report,
            });
            break;
          }

          const smartTasks = await this.generateSmartTasks(run, evaluation);
          for (const st of smartTasks) {
            this.queueManager.enqueue(run.id, {
              content: st.content,
              type: "smart_task",
              priority: st.priority,
            });
          }
          continue;
        }

        await this.executeTask(task, run);
      }
    } catch (err) {
      this.notify("run.status", {
        runId: run.id,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async executeTask(task: TaskDefinition, run: ExecutionRun): Promise<void> {
    const gitManager = new GitManager({ workingDir: run.workingDir });
    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);

    this.notify("task.status", { taskId: task.id, status: "running" });

    try {
      const context = await this.buildContext(task, run, gitManager);
      const systemPrompt = this.buildSystemPrompt(task, context);

      const result = await this.ccClient.executeTask(task.content, {
        workingDir: run.workingDir,
        sessionId: task.sessionId,
        timeoutMinutes: task.timeoutMinutes,
        maxTurns: 50,
        systemPrompt,
        abortSignal: abortController.signal,
      });

      this.notify("task.status", { taskId: task.id, status: "scoring" });

      const score = await this.scoreTask(task, result.result, run);

      if (score.passed) {
        const commitHash = await gitManager.autoCommit(task.id, task.content);
        this.notify("task.status", { taskId: task.id, status: "completed" });
        this.notify("git.commit", {
          taskId: task.id,
          runId: run.id,
          hash: commitHash,
          message: task.content,
          isAiCommit: true,
        });
      } else {
        await gitManager.revert("HEAD");
        this.notify("task.status", { taskId: task.id, status: "reverted" });
      }

      this.notify("task.scored", { taskId: task.id, score });
    } catch (err) {
      this.notify("task.status", {
        taskId: task.id,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.abortControllers.delete(task.id);
    }
  }

  private async buildContext(
    task: TaskDefinition,
    run: ExecutionRun,
    gitManager: GitManager,
  ): Promise<TaskContext> {
    const lastTenCommits = await gitManager.getLastNCommits(10);
    const nextFiveTasks = this.queueManager.peekNext(run.id, 5);

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
      lessonsLearned: [],
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
      for (const l of context.lessonsLearned) {
        parts.push(`  [${l.category}] ${l.lesson}`);
      }
    }

    return parts.join("\n");
  }

  private async evaluateGoal(run: ExecutionRun): Promise<GoalEvaluation> {
    const result = await this.ccClient.executeTask(
      `Evaluate whether the following goals have been achieved based on the current state of the project.\n\nGoals:\n${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}\n\nTermination conditions:\n${run.terminationConditions.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nRespond with a JSON object: { "isComplete": boolean, "progressReport": string, "completedGoals": string[], "remainingGoals": string[], "overallProgress": number }`,
      {
        workingDir: run.workingDir,
        timeoutMinutes: 5,
        maxTurns: 10,
      },
    );

    try {
      return JSON.parse(result.result) as GoalEvaluation;
    } catch {
      return {
        isComplete: false,
        progressReport: "Failed to parse evaluation",
        completedGoals: [],
        remainingGoals: run.goals,
        overallProgress: 0,
      };
    }
  }

  private async scoreTask(
    task: TaskDefinition,
    result: string,
    run: ExecutionRun,
  ): Promise<ScoreDetails> {
    const scoreResult = await this.ccClient.executeTask(
      `Score this task result against the overall goals.\n\nTask: ${task.content}\nResult: ${result.substring(0, 2000)}\n\nGoals:\n${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}\n\nRespond with JSON: { "goalAlignment": 0-0.3, "correctness": 0-0.3, "completeness": 0-0.2, "quality": 0-0.2, "overall": sum, "passed": overall >= ${QUALITY_THRESHOLD}, "reasoning": string }`,
      {
        workingDir: run.workingDir,
        timeoutMinutes: 5,
        maxTurns: 5,
      },
    );

    try {
      const parsed = JSON.parse(scoreResult.result);
      return {
        ...parsed,
        overall: (parsed.goalAlignment || 0) + (parsed.correctness || 0) +
                 (parsed.completeness || 0) + (parsed.quality || 0),
        passed: parsed.overall >= QUALITY_THRESHOLD,
      } as ScoreDetails;
    } catch {
      return {
        overall: 0,
        goalAlignment: 0,
        correctness: 0,
        completeness: 0,
        quality: 0,
        passed: false,
        reasoning: "Failed to parse scoring result",
      };
    }
  }

  private async generateSmartTasks(
    run: ExecutionRun,
    evaluation: GoalEvaluation,
  ): Promise<Array<{ content: string; priority: number; reasoning: string }>> {
    const result = await this.ccClient.executeTask(
      `Based on the current progress, generate the next tasks to work on.\n\nGoals:\n${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}\n\nRemaining goals:\n${evaluation.remainingGoals.map((g, i) => `${i + 1}. ${g}`).join("\n")}\n\nProgress: ${evaluation.progressReport}\n\nRespond with a JSON array of tasks: [{ "content": string, "priority": 1-10, "reasoning": string }]`,
      {
        workingDir: run.workingDir,
        timeoutMinutes: 5,
        maxTurns: 10,
      },
    );

    try {
      return JSON.parse(result.result);
    } catch {
      return [{
        content: `Continue working on: ${evaluation.remainingGoals[0] || "project goals"}`,
        priority: 5,
        reasoning: "Fallback task due to parsing failure",
      }];
    }
  }

  private async generateReport(run: ExecutionRun): Promise<string> {
    const result = await this.ccClient.executeTask(
      `Generate a final summary report for this completed task run.\n\nGoals:\n${run.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}\n\nProvide a concise summary of what was accomplished.`,
      {
        workingDir: run.workingDir,
        timeoutMinutes: 5,
        maxTurns: 10,
      },
    );
    return result.result;
  }

  cancelTask(taskId: string): void {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
    }
  }
}
