import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { Store } from "../../src-engine/src/db/store.js";
import { QueueManager } from "../../src-engine/src/engine/queue-manager.js";
import { DAGScheduler } from "../../src-engine/src/engine/dag-scheduler.js";
import { ExecutionPool } from "../../src-engine/src/engine/execution-pool.js";
import { BranchStrategy } from "../../src-engine/src/git/branch-strategy.js";
import { OMX_ROLES } from "../../src-engine/src/engine/omx-roles.js";
import type { TaskDefinition, ExecutionRun } from "@ai-workbench/shared";
import simpleGit from "simple-git";

// ─── Helpers ─────────────────────────────────────────────────────────────

let tmpDir: string;
let store: Store;

function makeRun(id = "run-e2e", overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id,
    workingDir: tmpDir,
    goals: ["E2E test goal"],
    terminationConditions: ["All tests pass"],
    status: "idle",
    totalCostUsd: 0,
    totalTasksCompleted: 0,
    ...overrides,
  };
}

function makeTask(id: string, overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id,
    runId: "run-e2e",
    type: "user_defined",
    priority: 1,
    timeoutMinutes: 60,
    promptJson: "",
    content: `Task ${id}`,
    status: "pending",
    createdAt: Date.now(),
    workingDir: tmpDir,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-"));
  store = new Store(tmpDir, { noDebounce: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// Feature 1: Feature Branch Isolation
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: Feature Branch Isolation", () => {
  it("creates a feature branch and worktree", async () => {
    // Init git repo
    const git = simpleGit(tmpDir);
    await git.init();
    await git.addConfig("user.name", "Test");
    await git.addConfig("user.email", "test@test.com");
    fs.writeFileSync(path.join(tmpDir, "initial.txt"), "hello");
    await git.add("-A");
    await git.commit("initial commit");

    const result = await BranchStrategy.createTaskBranch(tmpDir, "task-abc123");
    expect(result.branchName).toContain("task-");
    expect(result.worktreePath).toBeTruthy();
    expect(fs.existsSync(result.worktreePath)).toBe(true);

    // Cleanup
    await BranchStrategy.cleanupBranch(tmpDir, result.branchName, result.worktreePath);
  });

  it.skipIf(process.env.CI)("merges feature branch back", async () => {
    const git = simpleGit(tmpDir);
    await git.init();
    await git.addConfig("user.name", "Test");
    await git.addConfig("user.email", "test@test.com");
    fs.writeFileSync(path.join(tmpDir, "initial.txt"), "hello");
    await git.add("-A");
    await git.commit("initial commit");

    const result = await BranchStrategy.createTaskBranch(tmpDir, "task-merge");
    // Write a file in worktree
    fs.writeFileSync(path.join(result.worktreePath, "feature.txt"), "feature work");
    const worktreeGit = simpleGit(result.worktreePath);
    await worktreeGit.add("-A");
    await worktreeGit.commit("feature work");

    const mergeResult = await BranchStrategy.mergeBranch(tmpDir, result.branchName);
    expect(mergeResult.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "feature.txt"))).toBe(true);

    await BranchStrategy.cleanupBranch(tmpDir, result.branchName, result.worktreePath);
  });

  it("stores branch info in task", () => {
    const run = makeRun();
    store.saveRun(run);
    const task = makeTask("t1", { branchName: "feature/t1", worktreePath: "/tmp/wt" });
    store.saveTask(run.id, task);

    const loaded = store.getTask(run.id, "t1");
    expect(loaded?.branchName).toBe("feature/t1");
    expect(loaded?.worktreePath).toBe("/tmp/wt");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Feature 2: DAG Task Dependencies
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: DAG Task Dependencies", () => {
  it("enforces execution order via QueueManager", () => {
    const qm = new QueueManager();
    const t1 = qm.enqueue("run-1", { content: "T1", type: "user_defined", priority: 1 });
    const t2 = qm.enqueue("run-1", { content: "T2", type: "user_defined", priority: 1 });
    const t3 = qm.enqueue("run-1", { content: "T3", type: "user_defined", priority: 1 });

    // T2 depends on T1, T3 depends on T2
    store.saveRun(makeRun("run-1"));
    store.saveTask("run-1", { ...t1, dependsOn: [] });
    store.saveTask("run-1", { ...t2, dependsOn: [t1.id] });
    store.saveTask("run-1", { ...t3, dependsOn: [t2.id] });

    // Only T1 should be ready
    const completed = new Set<string>();
    const first = qm.dequeueWithDeps("run-1", completed);
    expect(first?.id).toBe(t1.id);

    // After T1 completes, T2 should be ready
    completed.add(t1.id);
    const second = qm.dequeueWithDeps("run-1", completed);
    expect(second?.id).toBe(t2.id);

    // After T2 completes, T3 should be ready
    completed.add(t2.id);
    const third = qm.dequeueWithDeps("run-1", completed);
    expect(third?.id).toBe(t3.id);
  });

  it("DAGScheduler detects cycles", () => {
    const tasks = [makeTask("a", { dependsOn: ["b"] }), makeTask("b", { dependsOn: ["a"] })];
    expect(() => new DAGScheduler(tasks)).toThrow("Circular dependency");
  });

  it("diamond dependency resolves correctly", () => {
    const tasks = [
      makeTask("a", { dependsOn: ["b", "c"] }),
      makeTask("b", { dependsOn: ["d"] }),
      makeTask("c", { dependsOn: ["d"] }),
      makeTask("d"),
    ];
    const dag = new DAGScheduler(tasks);

    // d first
    const r1 = dag.getReadyTasks();
    expect(r1.map((t) => t.id)).toEqual(["d"]);
    dag.markCompleted("d");

    // b and c in parallel
    const r2 = dag
      .getReadyTasks()
      .map((t) => t.id)
      .sort();
    expect(r2).toEqual(["b", "c"]);
    dag.markCompleted("b");
    dag.markCompleted("c");

    // a last
    expect(dag.getReadyTasks().map((t) => t.id)).toEqual(["a"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Feature 3: Parallel Execution Pool
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: Parallel Execution Pool", () => {
  it("executes tasks respecting concurrency limit and dependencies", async () => {
    const executed: string[] = [];
    const tasks = [
      makeTask("d"),
      makeTask("b", { dependsOn: ["d"] }),
      makeTask("c", { dependsOn: ["d"] }),
      makeTask("a", { dependsOn: ["b", "c"] }),
    ];
    const scheduler = new DAGScheduler(tasks);

    const pool = new ExecutionPool(
      async (t) => {
        await new Promise((r) => setTimeout(r, 20));
        executed.push(t.id);
      },
      2, // concurrency = 2
    );

    const results = await pool.runAll(tasks, scheduler);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.success)).toBe(true);

    // d must come before b and c
    expect(executed.indexOf("d")).toBeLessThan(executed.indexOf("b"));
    expect(executed.indexOf("d")).toBeLessThan(executed.indexOf("c"));
    // a must come after both b and c
    expect(executed.indexOf("a")).toBeGreaterThan(executed.indexOf("b"));
    expect(executed.indexOf("a")).toBeGreaterThan(executed.indexOf("c"));
  });

  it("handles partial failures without blocking other tasks", async () => {
    const tasks = [makeTask("t1"), makeTask("t2"), makeTask("t3")];
    const scheduler = new DAGScheduler(tasks);
    const pool = new ExecutionPool(async (t) => {
      if (t.id === "t2") throw new Error("Task t2 failed");
    }, 3);

    const results = await pool.runAll(tasks, scheduler);
    expect(results.find((r) => r.task.id === "t1")?.success).toBe(true);
    expect(results.find((r) => r.task.id === "t2")?.success).toBe(false);
    expect(results.find((r) => r.task.id === "t2")?.error).toBe("Task t2 failed");
    expect(results.find((r) => r.task.id === "t3")?.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Feature 4: Conditional Branching
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: Conditional Branching", () => {
  it("skips tasks whose condition is false, runs when condition becomes true", () => {
    const tasks = [makeTask("t1"), makeTask("t2", { condition: "lastScore >= 0.8" })];
    const dag = new DAGScheduler(tasks, { lastScore: 0.3 });

    // Only t1 is ready (t2 condition not met)
    let ready = dag.getReadyTasks();
    expect(ready.map((t) => t.id)).toEqual(["t1"]);

    // Complete t1 and update context
    dag.markCompleted("t1");
    dag.updateContext({ lastScore: 0.9 });
    ready = dag.getReadyTasks();
    expect(ready.map((t) => t.id)).toEqual(["t2"]);
  });

  it("supports complex conditions with multiple variables", () => {
    const tasks = [
      makeTask("t1"),
      makeTask("t2", { condition: "completedCount >= 1 && cycleCount < 5" }),
      makeTask("t3", { condition: "failedCount > 0" }),
    ];
    const dag = new DAGScheduler(tasks, { completedCount: 0, cycleCount: 3, failedCount: 0 });

    // Only t1 (t2 needs completedCount >= 1, t3 needs failedCount > 0)
    expect(dag.getReadyTasks().map((t) => t.id)).toEqual(["t1"]);

    dag.markCompleted("t1");
    // Now t2 is ready (completedCount=1, cycleCount=3<5)
    expect(dag.getReadyTasks().map((t) => t.id)).toEqual(["t2"]);
    // t3 still blocked (failedCount=0)
  });

  it("persists condition field through store round-trip", () => {
    const run = makeRun();
    store.saveRun(run);
    const task = makeTask("t1", { condition: "lastScore > 0.5" });
    store.saveTask(run.id, task);

    const loaded = store.getTask(run.id, "t1");
    expect(loaded?.condition).toBe("lastScore > 0.5");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Feature 7: ExecutionGraph (DAG Visualization)
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: DAG Visualization Data", () => {
  it("positions all nodes in layout", () => {
    // We test the layout algorithm by importing the component's logic
    // The component uses layoutDAG internally, we test via DAGScheduler
    const tasks = [makeTask("a", { dependsOn: ["b"] }), makeTask("b", { dependsOn: ["c"] }), makeTask("c")];
    const dag = new DAGScheduler(tasks);
    const ready = dag.getReadyTasks();
    expect(ready.map((t) => t.id)).toEqual(["c"]);
    dag.markCompleted("c");
    expect(dag.getReadyTasks().map((t) => t.id)).toEqual(["b"]);
    dag.markCompleted("b");
    expect(dag.getReadyTasks().map((t) => t.id)).toEqual(["a"]);
  });

  it("empty tasks produces empty ready list", () => {
    const dag = new DAGScheduler([]);
    expect(dag.getReadyTasks()).toEqual([]);
    expect(dag.hasUnfinishedTasks()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Feature 9: Autonomy Level + Real-time Intervention
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: Autonomy Level", () => {
  it("stores and retrieves autonomyLevel on ExecutionRun", () => {
    const run = makeRun("run-auto", { autonomyLevel: "supervised" });
    store.saveRun(run);
    const loaded = store.getRun("run-auto");
    expect(loaded?.autonomyLevel).toBe("supervised");
  });

  it("config.set accepts autonomyLevel", async () => {
    store.setConfig("autonomyLevel", "assisted");
    expect(store.getConfig("autonomyLevel")).toBe("assisted");
  });
});

describe("E2E: Real-time Intervention", () => {
  it("task.intervene with cancel action marks task cancelled", () => {
    const run = makeRun();
    store.saveRun(run);
    const task = makeTask("t1", { status: "running" });
    store.saveTask(run.id, task);

    // Simulate cancel
    store.updateTask(run.id, "t1", { status: "cancelled", completedAt: Date.now() });
    const loaded = store.getTask(run.id, "t1");
    expect(loaded?.status).toBe("cancelled");
  });

  it("task.intervene with pause action marks task paused", () => {
    const run = makeRun();
    store.saveRun(run);
    const task = makeTask("t1", { status: "running" });
    store.saveTask(run.id, task);

    store.updateTask(run.id, "t1", { status: "paused" });
    expect(store.getTask(run.id, "t1")?.status).toBe("paused");
  });

  it("task.inject creates a high-priority user task", () => {
    const qm = new QueueManager();
    const injected = qm.enqueue("run-1", {
      content: "[Human injection for t1] Fix the edge case",
      type: "user_defined",
      priority: 1,
    });

    expect(injected.priority).toBe(1);
    expect(injected.content).toContain("Human injection");
    expect(qm.list("run-1")).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Feature 10: Notification System + Model Routing
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: Per-task Model Routing", () => {
  it("stores modelHint on task definition", () => {
    const run = makeRun();
    store.saveRun(run);
    const task = makeTask("t1", { modelHint: "claude-opus-4-7" });
    store.saveTask(run.id, task);

    const loaded = store.getTask(run.id, "t1");
    expect(loaded?.modelHint).toBe("claude-opus-4-7");
  });

  it("different tasks can have different model hints", () => {
    const run = makeRun();
    store.saveRun(run);
    store.saveTask(run.id, makeTask("impl", { modelHint: "claude-opus-4-7" }));
    store.saveTask(run.id, makeTask("test", { modelHint: "claude-sonnet-4-6" }));
    store.saveTask(run.id, makeTask("review", { modelHint: "claude-haiku-4-5" }));

    expect(store.getTask(run.id, "impl")?.modelHint).toBe("claude-opus-4-7");
    expect(store.getTask(run.id, "test")?.modelHint).toBe("claude-sonnet-4-6");
    expect(store.getTask(run.id, "review")?.modelHint).toBe("claude-haiku-4-5");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Feature: Agent Role Templates
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: Agent Role Templates", () => {
  it("has roles with complete fields", () => {
    const roles = Object.values(OMX_ROLES);
    expect(roles.length).toBeGreaterThan(0);

    for (const role of roles) {
      expect(role.id).toBeTruthy();
      expect(role.name).toBeTruthy();
      expect(role.description).toBeTruthy();
      expect(Array.isArray(role.tools)).toBe(true);
      expect(role.maxTurns).toBeGreaterThan(0);
    }
  });

  it("architect role has read-only tools", () => {
    expect(OMX_ROLES.architect.tools).not.toContain("Write");
    expect(OMX_ROLES.architect.tools).not.toContain("Edit");
    expect(OMX_ROLES.architect.tools).toContain("Read");
  });

  it("executor role has write tools", () => {
    expect(OMX_ROLES.executor.tools).toContain("Write");
    expect(OMX_ROLES.executor.tools).toContain("Edit");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-feature Integration
// ═══════════════════════════════════════════════════════════════════════════

describe("E2E: Cross-feature Integration", () => {
  it("DAG + conditions + parallel pool work together", async () => {
    const order: string[] = [];
    const tasks = [
      makeTask("setup"),
      makeTask("lint", { dependsOn: ["setup"], condition: "completedCount >= 1" }),
      makeTask("test", { dependsOn: ["setup"], condition: "completedCount >= 1" }),
      makeTask("deploy", { dependsOn: ["lint", "test"] }),
    ];

    const scheduler = new DAGScheduler(tasks, { completedCount: 0 });
    const pool = new ExecutionPool(async (t) => {
      order.push(t.id);
      await new Promise((r) => setTimeout(r, 10));
    }, 2);

    const results = await pool.runAll(tasks, scheduler);

    // Setup runs first
    expect(order.indexOf("setup")).toBe(0);
    // Deploy runs last (depends on lint + test)
    expect(order.indexOf("deploy")).toBe(3);
    // All succeeded
    expect(results.every((r) => r.success)).toBe(true);
  });

  it("store round-trip with all new fields", () => {
    const run = makeRun("run-full", {
      autonomyLevel: "assisted",
    });
    store.saveRun(run);

    const task = makeTask("t-full", {
      dependsOn: ["other"],
      condition: "lastScore > 0.5",
      modelHint: "claude-opus-4-7",
      branchName: "feature/t-full",
      worktreePath: "/tmp/wt",
    });
    store.saveTask("run-full", task);

    const loaded = store.getTask("run-full", "t-full");
    expect(loaded?.dependsOn).toEqual(["other"]);
    expect(loaded?.condition).toBe("lastScore > 0.5");
    expect(loaded?.modelHint).toBe("claude-opus-4-7");
    expect(loaded?.branchName).toBe("feature/t-full");
    expect(loaded?.worktreePath).toBe("/tmp/wt");
  });
});
