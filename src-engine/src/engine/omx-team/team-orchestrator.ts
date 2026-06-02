/**
 * Team Orchestrator — 5-stage multi-agent parallel execution.
 *
 * State machine: team-plan → team-prd → team-exec → team-verify → team-fix
 * team-fix can loop back to team-exec (max 3 attempts).
 *
 * Uses OmxAmpWorkerManager for parallel worker management.
 */

import type { CCClient } from "../../cc-integration/cc-client.js";
import type { NotifyFn } from "../omx-pipeline.js";
import { OmxAmpWorkerManager } from "./worker-manager.js";
import type { WorkerConfig, WorkerTaskAssignment } from "./worker-protocol.js";
import { getTeamPhaseAgents } from "../omx-roles.js";
import type { TaskDefinition, ExecutionRun, TaskContext } from "@ai-workbench/shared";

export type TeamStage = "team-plan" | "team-prd" | "team-exec" | "team-verify" | "team-fix" | "complete" | "failed";

interface TeamState {
  phase: TeamStage;
  fixAttempt: number;
  maxFixAttempts: number;
  results: Map<string, { success: boolean; output: string }>;
}

const TEAM_TRANSITIONS: Record<TeamStage, TeamStage[]> = {
  "team-plan": ["team-prd"],
  "team-prd": ["team-exec"],
  "team-exec": ["team-verify"],
  "team-verify": ["team-fix", "complete", "failed"],
  "team-fix": ["team-exec", "team-verify", "complete", "failed"],
  "complete": [],
  "failed": [],
};

export interface TeamConfig {
  maxWorkers: number;
  worktreeIsolation: boolean;
  maxFixAttempts: number;
}

export interface TeamResult {
  totalCostUsd: number;
  totalDurationMs: number;
  completedTasks: number;
  failedTasks: number;
}

export class OmxAmpTeamOrchestrator {
  private state: TeamState = {
    phase: "team-plan",
    fixAttempt: 0,
    maxFixAttempts: 3,
    results: new Map(),
  };

  constructor(
    private ccClient: CCClient,
    private notify: NotifyFn,
    private config: TeamConfig = { maxWorkers: 2, worktreeIsolation: true, maxFixAttempts: 3 },
  ) {
    this.state.maxFixAttempts = config.maxFixAttempts;
  }

  async execute(
    tasks: TaskDefinition[],
    run: ExecutionRun,
    context: TaskContext,
    abortSignal?: AbortSignal,
  ): Promise<TeamResult> {
    const startTime = Date.now();
    let totalCost = 0;
    this.state.results = new Map();

    const workerManager = new OmxAmpWorkerManager(this.notify, this.config.maxWorkers);

    try {
      // Phase: team-plan — analyze tasks and create execution plan
      this.state.phase = "team-plan";
      this.notify("log.entry", { level: "info", source: "engine", message: `[team] Phase: team-plan (${tasks.length} tasks)` });

      const planResult = await this.runTeamPhaseWithCC(
        "team-plan", tasks, run, context, abortSignal,
      );
      totalCost += planResult.totalCostUsd;

      // Phase: team-prd — generate task specifications
      this.transitionTo("team-prd");
      const prdResult = await this.runTeamPhaseWithCC(
        "team-prd", tasks, run, context, abortSignal,
      );
      totalCost += prdResult.totalCostUsd;

      // Phase: team-exec — parallel execution via workers
      this.transitionTo("team-exec");
      const workerConfigs: WorkerConfig[] = [];
      for (let i = 0; i < Math.min(this.config.maxWorkers, tasks.length); i++) {
        const task = tasks[i];
        workerConfigs.push({
          workerId: `worker-${i}`,
          workingDir: task?.worktreePath || run.workingDir,
          branchName: task?.branchName,
        });
      }

      await workerManager.spawn(workerConfigs);

      // Dispatch tasks to workers round-robin
      const availableWorkers = workerManager.getAvailableWorkers();
      let workerIdx = 0;
      const dispatchPromises: Promise<unknown>[] = [];
      const TASK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

      for (const task of tasks) {
        if (abortSignal?.aborted) break;
        const workerId = availableWorkers[workerIdx % availableWorkers.length];
        const assignment: WorkerTaskAssignment = {
          taskId: task.id,
          content: task.content,
          workingDir: task.worktreePath || run.workingDir,
          branchName: task.branchName,
          timeoutMinutes: task.timeoutMinutes,
        };

        const dispatchPromise = workerManager.dispatch(workerId, assignment);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Task ${task.id.substring(0, 6)} timed out`)), TASK_TIMEOUT_MS)
        );

        dispatchPromises.push(
          Promise.race([dispatchPromise, timeoutPromise])
            .then((result) => {
              this.state.results.set(task.id, { success: result.success, output: result.output });
              totalCost += result.costUsd;
              this.notify("task.status", {
                taskId: task.id,
                status: result.success ? "completed" : "failed",
                result: result.output,
                costUsd: result.costUsd,
                durationMs: result.durationMs,
              });
            })
            .catch((err) => {
              this.state.results.set(task.id, { success: false, output: err.message });
              this.notify("task.status", { taskId: task.id, status: "failed", errorMessage: err.message });
            }),
        );
        workerIdx++;
      }

      await Promise.all(dispatchPromises);

      // Phase: team-verify
      this.transitionTo("team-verify");
      const failedTasks = tasks.filter((t) => {
        const r = this.state.results.get(t.id);
        return !r?.success;
      });

      if (failedTasks.length > 0 && this.state.fixAttempt < this.state.maxFixAttempts) {
        // Phase: team-fix — attempt to fix failed tasks
        this.transitionTo("team-fix");
        this.state.fixAttempt++;

        this.notify("log.entry", {
          level: "info",
          source: "engine",
          message: `[team] Fix attempt ${this.state.fixAttempt}: ${failedTasks.length} failed tasks`,
        });

        // Loop back to team-exec for failed tasks only
        this.transitionTo("team-exec");
        // In a full implementation, we'd re-dispatch only failed tasks
      }

      return {
        totalCostUsd: totalCost,
        totalDurationMs: Date.now() - startTime,
        completedTasks: tasks.filter((t) => this.state.results.get(t.id)?.success).length,
        failedTasks: tasks.filter((t) => !this.state.results.get(t.id)?.success).length,
      };
    } finally {
      await workerManager.terminate();
    }
  }

  private transitionTo(phase: TeamStage): void {
    const allowed = TEAM_TRANSITIONS[this.state.phase];
    if (!allowed?.includes(phase) && phase !== "complete" && phase !== "failed") {
      this.notify("log.entry", { level: "warn", source: "engine", message: `[team] Invalid transition: ${this.state.phase} -> ${phase}` });
    }
    this.state.phase = phase;
  }

  private async runTeamPhaseWithCC(
    phase: string,
    tasks: TaskDefinition[],
    run: ExecutionRun,
    context: TaskContext,
    abortSignal?: AbortSignal,
  ): Promise<{ totalCostUsd: number }> {
    const agents = getTeamPhaseAgents(phase);
    const agent = agents[0];
    if (!agent) return { totalCostUsd: 0 };

    const prompt = `[Team Phase: ${phase}]
## Tasks
${tasks.map((t) => `- [${t.id}] ${t.content}`).join("\n")}

## Project Goals
${context.goals.map((g) => `- ${g}`).join("\n")}

## Instructions
Analyze the tasks above for this team phase and provide structured output.`;

    const result = await this.ccClient.executeTask(prompt, {
      workingDir: run.workingDir,
      timeoutMinutes: 10,
      maxTurns: agent.maxTurns,
      systemPrompt: `You are a ${agent.name}. ${agent.description}`,
      abortSignal,
    });

    this.notify("log.entry", {
      level: "info",
      source: "engine",
      message: `[team:${phase}] completed (cost: $${result.totalCostUsd.toFixed(4)})`,
    });

    return { totalCostUsd: result.totalCostUsd };
  }
}
