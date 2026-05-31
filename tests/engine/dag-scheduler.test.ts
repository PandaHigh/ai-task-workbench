import { describe, it, expect } from "vitest";
import { DAGScheduler } from "../../src-engine/src/engine/dag-scheduler.js";
import type { TaskDefinition } from "@ai-workbench/shared";

function makeTask(id: string, dependsOn?: string[]): TaskDefinition {
  return {
    id,
    runId: "test",
    type: "user_defined",
    priority: 1,
    timeoutMinutes: 60,
    promptJson: "",
    content: `Task ${id}`,
    status: "pending",
    createdAt: Date.now(),
    dependsOn,
  };
}

describe("DAGScheduler", () => {
  it("should return tasks with no dependencies first", () => {
    const dag = new DAGScheduler([makeTask("a", ["b"]), makeTask("b")]);
    const ready = dag.getReadyTasks();
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe("b");
  });

  it("should return dependent tasks after dependencies complete", () => {
    const dag = new DAGScheduler([makeTask("a", ["b"]), makeTask("b")]);
    dag.markCompleted("b");
    const ready = dag.getReadyTasks();
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe("a");
  });

  it("should detect circular dependencies", () => {
    expect(() => new DAGScheduler([makeTask("a", ["b"]), makeTask("b", ["a"])])).toThrow("Circular dependency");
  });

  it("should handle diamond dependency", () => {
    // a depends on b and c, b and c depend on d
    const dag = new DAGScheduler([
      makeTask("a", ["b", "c"]),
      makeTask("b", ["d"]),
      makeTask("c", ["d"]),
      makeTask("d"),
    ]);
    expect(dag.getReadyTasks().map(t => t.id)).toEqual(["d"]);
    dag.markCompleted("d");
    const ready = dag.getReadyTasks().map(t => t.id);
    expect(ready.sort()).toEqual(["b", "c"]);
    dag.markCompleted("b");
    dag.markCompleted("c");
    expect(dag.getReadyTasks().map(t => t.id)).toEqual(["a"]);
  });

  it("should handle tasks with no dependencies", () => {
    const dag = new DAGScheduler([makeTask("a"), makeTask("b"), makeTask("c")]);
    expect(dag.getReadyTasks()).toHaveLength(3);
  });

  it("should report unfinished tasks correctly", () => {
    const dag = new DAGScheduler([makeTask("a"), makeTask("b")]);
    expect(dag.hasUnfinishedTasks()).toBe(true);
    dag.markCompleted("a");
    expect(dag.hasUnfinishedTasks()).toBe(true);
    dag.markCompleted("b");
    expect(dag.hasUnfinishedTasks()).toBe(false);
  });

  it("should respect the limit parameter", () => {
    const dag = new DAGScheduler([makeTask("a"), makeTask("b"), makeTask("c")]);
    expect(dag.getReadyTasks(2)).toHaveLength(2);
  });

  it("should report dependency count correctly", () => {
    const dag = new DAGScheduler([makeTask("a", ["b", "c"]), makeTask("b"), makeTask("c")]);
    expect(dag.getDependencyCount("a")).toBe(2);
    expect(dag.getDependencyCount("b")).toBe(0);
    expect(dag.getDependencyCount("unknown")).toBe(0);
  });

  it("should exclude skipped tasks from ready list", () => {
    const dag = new DAGScheduler([makeTask("a"), makeTask("b")]);
    dag.markSkipped("a");
    const ready = dag.getReadyTasks();
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe("b");
  });

  it("should treat skipped dependencies as satisfied", () => {
    const dag = new DAGScheduler([makeTask("a", ["b"]), makeTask("b")]);
    dag.markSkipped("b");
    const ready = dag.getReadyTasks();
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe("a");
  });

  it("should skip tasks whose condition evaluates to false", () => {
    const tasks = [
      { ...makeTask("a"), condition: "lastScore >= 0.8" },
      makeTask("b"),
    ];
    const dag = new DAGScheduler(tasks, { lastScore: 0.3 });
    const ready = dag.getReadyTasks();
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe("b");
  });

  it("should include tasks whose condition evaluates to true", () => {
    const tasks = [
      { ...makeTask("a"), condition: "lastScore >= 0.8" },
      makeTask("b"),
    ];
    const dag = new DAGScheduler(tasks, { lastScore: 0.9 });
    const ready = dag.getReadyTasks();
    expect(ready).toHaveLength(2);
  });

  it("should skip tasks when condition evaluation fails", () => {
    const tasks = [
      { ...makeTask("a"), condition: "undefinedVar.property" },
      makeTask("b"),
    ];
    const dag = new DAGScheduler(tasks);
    const ready = dag.getReadyTasks();
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe("b");
  });

  it("should support cycleCount in condition", () => {
    const tasks = [
      { ...makeTask("a"), condition: "cycleCount < 3" },
    ];
    const dag = new DAGScheduler(tasks, { cycleCount: 5 });
    const ready = dag.getReadyTasks();
    expect(ready).toHaveLength(0);
  });

  it("should update context and affect subsequent evaluations", () => {
    const tasks = [
      { ...makeTask("a"), condition: "completedCount >= 1" },
      makeTask("b"),
    ];
    const dag = new DAGScheduler(tasks, { completedCount: 0 });
    expect(dag.getReadyTasks().map(t => t.id)).toEqual(["b"]);
    dag.markCompleted("b");
    dag.updateContext({ completedCount: 1 });
    expect(dag.getReadyTasks().map(t => t.id)).toEqual(["a"]);
  });
});
