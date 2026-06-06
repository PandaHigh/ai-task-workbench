import { describe, it, expect, vi } from "vitest";
import { ExecutionPool } from "../../src-engine/src/engine/execution-pool.js";
import { DAGScheduler } from "../../src-engine/src/engine/dag-scheduler.js";
import type { TaskDefinition } from "@ai-workbench/shared";

function makeTask(id: string, overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id,
    content: `Task ${id}`,
    type: "user_defined",
    status: "pending",
    priority: 1,
    createdAt: Date.now(),
    workingDir: "/tmp",
    runId: "run-1",
    dependsOn: [],
    ...overrides,
  };
}

describe("ExecutionPool", () => {
  it("executes a single task", async () => {
    const executed: string[] = [];
    const task = makeTask("t1");
    const pool = new ExecutionPool(async (t) => {
      executed.push(t.id);
    }, 1);
    const scheduler = new DAGScheduler([task]);
    const results = await pool.runAll([task], scheduler);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(executed).toEqual(["t1"]);
  });

  it("executes multiple independent tasks concurrently", async () => {
    const executed: string[] = [];
    const tasks = [makeTask("t1"), makeTask("t2"), makeTask("t3")];
    const pool = new ExecutionPool(async (t) => {
      await new Promise((r) => setTimeout(r, 10));
      executed.push(t.id);
    }, 3);
    const scheduler = new DAGScheduler(tasks);
    const results = await pool.runAll(tasks, scheduler);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(new Set(executed)).toEqual(new Set(["t1", "t2", "t3"]));
  });

  it("respects concurrency limit", async () => {
    let maxConcurrent = 0;
    let current = 0;
    const tasks = [makeTask("t1"), makeTask("t2"), makeTask("t3"), makeTask("t4")];
    const pool = new ExecutionPool(async () => {
      current++;
      if (current > maxConcurrent) maxConcurrent = current;
      await new Promise((r) => setTimeout(r, 50));
      current--;
    }, 2);
    const scheduler = new DAGScheduler(tasks);
    await pool.runAll(tasks, scheduler);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("respects dependency order", async () => {
    const order: string[] = [];
    const tasks = [makeTask("t1"), makeTask("t2", { dependsOn: ["t1"] }), makeTask("t3", { dependsOn: ["t2"] })];
    const pool = new ExecutionPool(async (t) => {
      order.push(t.id);
      await new Promise((r) => setTimeout(r, 10));
    }, 2);
    const scheduler = new DAGScheduler(tasks);
    await pool.runAll(tasks, scheduler);
    expect(order.indexOf("t1")).toBeLessThan(order.indexOf("t2"));
    expect(order.indexOf("t2")).toBeLessThan(order.indexOf("t3"));
  });

  it("handles task failures", async () => {
    const tasks = [makeTask("t1"), makeTask("t2")];
    const pool = new ExecutionPool(async (t) => {
      if (t.id === "t1") throw new Error("Task failed");
    }, 2);
    const scheduler = new DAGScheduler(tasks);
    const results = await pool.runAll(tasks, scheduler);
    expect(results.find((r) => r.task.id === "t1")?.success).toBe(false);
    expect(results.find((r) => r.task.id === "t1")?.error).toBe("Task failed");
    expect(results.find((r) => r.task.id === "t2")?.success).toBe(true);
  });

  it("calls onTaskComplete callback", async () => {
    const completed: string[] = [];
    const tasks = [makeTask("t1"), makeTask("t2")];
    const pool = new ExecutionPool(async () => {}, 2);
    const scheduler = new DAGScheduler(tasks);
    await pool.runAll(tasks, scheduler, (task) => completed.push(task.id));
    expect(completed).toEqual(["t1", "t2"]);
  });

  it("handles tasks with no ready tasks (scheduler sees none)", async () => {
    // Tasks that scheduler doesn't know about — runAll should complete with empty results
    const pool = new ExecutionPool(async () => {}, 2);
    const orphanTasks = [
      makeTask("t1", { dependsOn: ["t2"], status: "pending" }),
      makeTask("t2", { dependsOn: ["t1"], status: "pending" }),
    ];
    // DAGScheduler detects cycles on construction, so use an empty scheduler
    // The pool sees no ready tasks and exits immediately
    const scheduler = new DAGScheduler([]);
    const results = await pool.runAll(orphanTasks, scheduler);
    expect(results).toHaveLength(0);
  });
});
