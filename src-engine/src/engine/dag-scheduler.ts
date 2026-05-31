import type { TaskDefinition } from "@ai-workbench/shared";

export class DAGScheduler {
  private adjacency = new Map<string, Set<string>>(); // taskId -> set of dependency taskIds
  private tasks = new Map<string, TaskDefinition>();
  private completed = new Set<string>();
  private skipped = new Set<string>();

  constructor(tasks: TaskDefinition[]) {
    for (const task of tasks) {
      this.tasks.set(task.id, task);
      this.adjacency.set(task.id, new Set(task.dependsOn || []));
    }
    // Validate no cycles
    this.validateNoCycles();
  }

  markCompleted(taskId: string): void {
    this.completed.add(taskId);
  }

  markSkipped(taskId: string): void {
    this.skipped.add(taskId);
  }

  /**
   * Get tasks whose dependencies are all satisfied and are ready to execute.
   * Ordered by priority (highest first), user_defined before smart tasks.
   */
  getReadyTasks(limit?: number): TaskDefinition[] {
    const ready: TaskDefinition[] = [];
    for (const [taskId, deps] of this.adjacency) {
      if (this.completed.has(taskId) || this.skipped.has(taskId)) continue;
      const task = this.tasks.get(taskId);
      if (!task || task.status !== "pending") continue;

      // Check all dependencies are completed or skipped
      const allDepsMet = [...deps].every(
        (depId) => this.completed.has(depId) || this.skipped.has(depId)
      );
      if (allDepsMet) {
        ready.push(task);
      }
    }

    // Sort: user_defined first, then by priority (highest first)
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
          if (!this.adjacency.has(dep)) continue; // skip missing deps
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
