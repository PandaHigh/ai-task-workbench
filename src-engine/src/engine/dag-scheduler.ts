import type { TaskDefinition } from "@ai-workbench/shared";

export interface ExecutionContext {
  lastScore?: number;
  lastStatus?: string;
  cycleCount?: number;
  completedCount?: number;
  failedCount?: number;
  [key: string]: unknown;
}

export class DAGScheduler {
  private adjacency = new Map<string, Set<string>>(); // taskId -> set of dependency taskIds
  private tasks = new Map<string, TaskDefinition>();
  private completed = new Set<string>();
  private skipped = new Set<string>();
  private context: ExecutionContext;

  constructor(tasks: TaskDefinition[], initialContext?: ExecutionContext) {
    this.context = { cycleCount: 0, completedCount: 0, failedCount: 0, ...initialContext };
    for (const task of tasks) {
      this.tasks.set(task.id, task);
      this.adjacency.set(task.id, new Set(task.dependsOn || []));
    }
    this.validateNoCycles();
  }

  updateContext(updates: Partial<ExecutionContext>): void {
    Object.assign(this.context, updates);
  }

  getContext(): Readonly<ExecutionContext> {
    return this.context;
  }

  markCompleted(taskId: string): void {
    this.completed.add(taskId);
    this.context.completedCount = (this.context.completedCount ?? 0) + 1;
  }

  markSkipped(taskId: string): void {
    this.skipped.add(taskId);
    this.context.failedCount = (this.context.failedCount ?? 0) + 1;
  }

  /**
   * Get tasks whose dependencies are all satisfied and conditions are met.
   * Ordered by priority (highest first), user_defined before smart tasks.
   */
  getReadyTasks(limit?: number): TaskDefinition[] {
    const ready: TaskDefinition[] = [];
    for (const [taskId, deps] of this.adjacency) {
      if (this.completed.has(taskId) || this.skipped.has(taskId)) continue;
      const task = this.tasks.get(taskId);
      if (!task || task.status !== "pending") continue;

      const allDepsMet = [...deps].every(
        (depId) => this.completed.has(depId) || this.skipped.has(depId)
      );
      if (!allDepsMet) continue;

      // Evaluate condition if present — don't skip, just exclude from ready
      if (task.condition && !this.evaluateCondition(task.condition)) {
        continue;
      }

      ready.push(task);
    }

    ready.sort((a, b) => {
      if (a.type === "user_defined" && b.type !== "user_defined") return -1;
      if (a.type !== "user_defined" && b.type === "user_defined") return 1;
      return (b.priority ?? 1) - (a.priority ?? 1);
    });

    return limit ? ready.slice(0, limit) : ready;
  }

  hasUnfinishedTasks(): boolean {
    for (const [taskId] of this.adjacency) {
      if (!this.completed.has(taskId) && !this.skipped.has(taskId)) {
        const task = this.tasks.get(taskId);
        if (task && task.status !== "cancelled") return true;
      }
    }
    return false;
  }

  getDependencyCount(taskId: string): number {
    return this.adjacency.get(taskId)?.size ?? 0;
  }

  private evaluateCondition(condition: string): boolean {
    try {
      const fn = new Function(...Object.keys(this.context), `return (${condition});`);
      return !!fn(...Object.values(this.context));
    } catch {
      // If condition evaluation fails, skip the task
      return false;
    }
  }

  private validateNoCycles(): void {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (taskId: string): void => {
      if (inStack.has(taskId)) {
        throw new Error(`Circular dependency detected involving task: ${taskId}`);
      }
      if (visited.has(taskId)) return;
      visited.add(taskId);
      inStack.add(taskId);
      const deps = this.adjacency.get(taskId);
      if (deps) {
        for (const dep of deps) {
          if (!this.adjacency.has(dep)) continue;
          dfs(dep);
        }
      }
      inStack.delete(taskId);
    };

    for (const taskId of this.adjacency.keys()) {
      dfs(taskId);
    }
  }
}
