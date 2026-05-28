import type { TaskDefinition, CreateTaskParams } from "@ai-workbench/shared";
import crypto from "crypto";

interface QueueEntry {
  task: TaskDefinition;
  position: number;
}

export class QueueManager {
  private queues: Map<string, QueueEntry[]> = new Map();

  enqueue(runId: string, params: CreateTaskParams): TaskDefinition {
    for (const existing of this.queues.get(runId) || []) {
      if (existing.task.content === params.content && existing.task.type === (params.type || "smart_task")) {
        return existing.task;
      }
    }

    const queue = this.getOrCreateQueue(runId);
    if (queue.length >= 200) {
      throw new Error("Queue is full (max 200 tasks)");
    }

    const task: TaskDefinition = {
      id: crypto.randomUUID(),
      runId,
      type: params.type || "smart_task",
      priority: params.priority ?? 5,
      content: params.content,
      timeoutMinutes: params.timeoutMinutes ?? 60,
      promptJson: params.promptJson ?? "",
      status: "pending",
      createdAt: Date.now(),
    };

    const position = queue.length;
    queue.push({ task, position });

    queue.sort((a, b) => {
      if (a.task.type === "user_defined" && b.task.type !== "user_defined") return -1;
      if (a.task.type !== "user_defined" && b.task.type === "user_defined") return 1;
      return a.task.priority - b.task.priority;
    });

    queue.forEach((entry, i) => { entry.position = i; });

    return task;
  }

  dequeue(runId: string): TaskDefinition | null {
    const queue = this.queues.get(runId);
    if (!queue || queue.length === 0) return null;
    return queue.shift()!.task;
  }

  dequeueForRole(runId: string, roleId: string): TaskDefinition | null {
    const queue = this.queues.get(runId);
    if (!queue || queue.length === 0) return null;

    // Prefer tasks explicitly assigned to this role
    const roleIdx = queue.findIndex((e) => e.task.assignedRoleId === roleId);
    if (roleIdx !== -1) {
      return queue.splice(roleIdx, 1)[0].task;
    }

    // Fall back to unassigned tasks
    const unassignedIdx = queue.findIndex((e) => !e.task.assignedRoleId);
    if (unassignedIdx !== -1) {
      return queue.splice(unassignedIdx, 1)[0].task;
    }

    // Last resort: take any task
    return queue.shift()!.task;
  }

  peekNext(runId: string, count: number): TaskDefinition[] {
    const queue = this.queues.get(runId);
    if (!queue) return [];
    return queue.slice(0, count).map((e) => e.task);
  }

  list(runId: string): TaskDefinition[] {
    const queue = this.queues.get(runId);
    if (!queue) return [];
    return queue.map((e) => e.task);
  }

  reorder(runId: string, taskIds: string[]): void {
    const queue = this.queues.get(runId);
    if (!queue) return;

    const taskMap = new Map(queue.map((e) => [e.task.id, e]));
    const reordered: QueueEntry[] = [];

    for (let i = 0; i < taskIds.length; i++) {
      const entry = taskMap.get(taskIds[i]);
      if (entry) {
        entry.position = i;
        reordered.push(entry);
      }
    }

    const taskIdSet = new Set(taskIds);

    for (const entry of queue) {
      if (!taskIdSet.has(entry.task.id)) {
        entry.position = reordered.length;
        reordered.push(entry);
      }
    }

    this.queues.set(runId, reordered);
  }

  remove(runId: string, taskId: string): boolean {
    const queue = this.queues.get(runId);
    if (!queue) return false;

    const index = queue.findIndex((e) => e.task.id === taskId);
    if (index === -1) return false;

    queue.splice(index, 1);
    queue.forEach((entry, i) => { entry.position = i; });
    return true;
  }

  clear(runId: string): void {
    this.queues.delete(runId);
  }

  /** Restore an existing task into the queue (preserves original id/createdAt) */
  restore(runId: string, task: TaskDefinition): void {
    const queue = this.getOrCreateQueue(runId);
    if (queue.some((e) => e.task.id === task.id)) return;
    queue.push({ task, position: queue.length });
    queue.sort((a, b) => {
      if (a.task.type === "user_defined" && b.task.type !== "user_defined") return -1;
      if (a.task.type !== "user_defined" && b.task.type === "user_defined") return 1;
      return a.task.priority - b.task.priority;
    });
    queue.forEach((entry, i) => { entry.position = i; });
  }

  private getOrCreateQueue(runId: string): QueueEntry[] {
    let queue = this.queues.get(runId);
    if (!queue) {
      queue = [];
      this.queues.set(runId, queue);
    }
    return queue;
  }
}
