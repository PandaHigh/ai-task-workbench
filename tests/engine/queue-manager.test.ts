import { describe, it, expect, beforeEach } from "vitest";
import { QueueManager } from "../../src-engine/src/engine/queue-manager.js";

describe("QueueManager", () => {
  let queue: QueueManager;
  const runId = "test-run-1";

  beforeEach(() => {
    queue = new QueueManager();
  });

  it("should enqueue and dequeue tasks", () => {
    const task = queue.enqueue(runId, {
      content: "Test task",
      type: "smart_task",
      priority: 5,
    });

    expect(task.content).toBe("Test task");
    expect(task.type).toBe("smart_task");
    expect(task.status).toBe("pending");

    const dequeued = queue.dequeue(runId);
    expect(dequeued).not.toBeNull();
    expect(dequeued!.id).toBe(task.id);
  });

  it("should prioritize user_defined tasks over smart_tasks", () => {
    queue.enqueue(runId, { content: "Smart task 1", type: "smart_task", priority: 1 });
    queue.enqueue(runId, { content: "User task", type: "user_defined", priority: 5 });
    queue.enqueue(runId, { content: "Smart task 2", type: "smart_task", priority: 3 });

    const first = queue.dequeue(runId);
    expect(first!.type).toBe("user_defined");
    expect(first!.content).toBe("User task");
  });

  it("should sort by priority within same type", () => {
    queue.enqueue(runId, { content: "P5 task", type: "smart_task", priority: 5 });
    queue.enqueue(runId, { content: "P1 task", type: "smart_task", priority: 1 });
    queue.enqueue(runId, { content: "P3 task", type: "smart_task", priority: 3 });

    const first = queue.dequeue(runId);
    expect(first!.content).toBe("P1 task");
    const second = queue.dequeue(runId);
    expect(second!.content).toBe("P3 task");
  });

  it("should return null when queue is empty", () => {
    expect(queue.dequeue(runId)).toBeNull();
  });

  it("should list all tasks", () => {
    queue.enqueue(runId, { content: "Task 1", type: "smart_task", priority: 1 });
    queue.enqueue(runId, { content: "Task 2", type: "smart_task", priority: 2 });

    const list = queue.list(runId);
    expect(list).toHaveLength(2);
  });

  it("should peek next N tasks without removing", () => {
    queue.enqueue(runId, { content: "Task 1", type: "smart_task", priority: 1 });
    queue.enqueue(runId, { content: "Task 2", type: "smart_task", priority: 2 });
    queue.enqueue(runId, { content: "Task 3", type: "smart_task", priority: 3 });

    const peeked = queue.peekNext(runId, 2);
    expect(peeked).toHaveLength(2);

    const all = queue.list(runId);
    expect(all).toHaveLength(3);
  });

  it("should reorder tasks", () => {
    const t1 = queue.enqueue(runId, { content: "Task 1", type: "smart_task", priority: 1 });
    const t2 = queue.enqueue(runId, { content: "Task 2", type: "smart_task", priority: 2 });
    const t3 = queue.enqueue(runId, { content: "Task 3", type: "smart_task", priority: 3 });

    queue.reorder(runId, [t3.id, t1.id, t2.id]);

    const first = queue.dequeue(runId);
    expect(first!.id).toBe(t3.id);
  });

  it("should remove a task", () => {
    const t1 = queue.enqueue(runId, { content: "Task 1", type: "smart_task", priority: 1 });
    queue.enqueue(runId, { content: "Task 2", type: "smart_task", priority: 2 });

    expect(queue.remove(runId, t1.id)).toBe(true);
    expect(queue.list(runId)).toHaveLength(1);
  });

  it("should separate queues by runId", () => {
    queue.enqueue("run-1", { content: "Run1 task", type: "smart_task", priority: 1 });
    queue.enqueue("run-2", { content: "Run2 task", type: "smart_task", priority: 1 });

    expect(queue.list("run-1")).toHaveLength(1);
    expect(queue.list("run-2")).toHaveLength(1);
  });

  it("should deduplicate identical tasks", () => {
    const t1 = queue.enqueue("run-1", { content: "Same task", type: "smart_task", priority: 1 });
    const t2 = queue.enqueue("run-1", { content: "Same task", type: "smart_task", priority: 1 });
    expect(t1.id).toBe(t2.id);
    expect(queue.list("run-1")).toHaveLength(1);
  });

  it("should reject enqueue when queue is full", () => {
    for (let i = 0; i < 200; i++) {
      queue.enqueue("run-1", { content: `Task ${i}`, type: "smart_task", priority: 1 });
    }
    expect(() => queue.enqueue("run-1", { content: "Overflow", type: "smart_task", priority: 1 }))
      .toThrow("Queue is full");
  });

  it("should restore tasks into queue", () => {
    const task = {
      id: "restored-1", runId: "run-1", content: "Restored",
      type: "user_defined" as const, priority: 1, status: "pending" as const,
      createdAt: Date.now(),
    };
    queue.restore("run-1", task);
    expect(queue.list("run-1")).toHaveLength(1);
    expect(queue.list("run-1")[0].id).toBe("restored-1");
  });

  it("should return false when removing nonexistent task", () => {
    expect(queue.remove("run-1", "nonexistent")).toBe(false);
  });
});
