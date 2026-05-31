import type { TaskDefinition } from "@ai-workbench/shared";
import { DAGScheduler } from "./dag-scheduler.js";

interface PoolTaskResult {
  task: TaskDefinition;
  success: boolean;
  error?: string;
}

type ExecuteFn = (task: TaskDefinition) => Promise<void>;

export class ExecutionPool {
  private concurrency: number;
  private executeFn: ExecuteFn;
  private activeCount = 0;
  private activeTasks = new Map<string, Promise<void>>();
  private pendingResults: PoolTaskResult[] = [];
  private allResults: PoolTaskResult[] = [];

  constructor(executeFn: ExecuteFn, concurrency: number = 1) {
    this.executeFn = executeFn;
    this.concurrency = Math.max(1, concurrency);
  }

  get runningCount(): number {
    return this.activeCount;
  }

  get completedResults(): ReadonlyArray<PoolTaskResult> {
    return this.allResults;
  }

  async runAll(
    tasks: TaskDefinition[],
    scheduler: DAGScheduler,
    onTaskComplete?: (task: TaskDefinition) => void,
  ): Promise<PoolTaskResult[]> {
    this.pendingResults = [];
    this.allResults = [];
    this.activeTasks.clear();
    this.activeCount = 0;

    const launched = new Set<string>();

    while (true) {
      // Drain completed results first
      while (this.pendingResults.length > 0) {
        const r = this.pendingResults.shift()!;
        this.allResults.push(r);
        if (r.success) {
          scheduler.markCompleted(r.task.id);
          onTaskComplete?.(r.task);
        } else {
          scheduler.markSkipped(r.task.id);
        }
      }

      // Find ready tasks that haven't been launched yet
      const readyTasks = scheduler.getReadyTasks().filter((t) => !launched.has(t.id));

      // Launch tasks up to concurrency
      let launchedCount = 0;
      for (const task of readyTasks) {
        if (this.activeCount >= this.concurrency) break;
        launched.add(task.id);
        this.startTask(task);
        launchedCount++;
      }

      // Exit when nothing is running and nothing to launch
      if (this.activeCount === 0 && launchedCount === 0) break;

      // Wait for at least one task to complete
      if (this.activeCount > 0) {
        await Promise.race([...this.activeTasks.values()]);
      }
    }

    return this.allResults;
  }

  private startTask(task: TaskDefinition): void {
    this.activeCount++;
    const promise = this.executeFn(task)
      .then(() => {
        this.pendingResults.push({ task, success: true });
      })
      .catch((err) => {
        this.pendingResults.push({ task, success: false, error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        this.activeCount--;
        this.activeTasks.delete(task.id);
      });
    this.activeTasks.set(task.id, promise);
  }
}
