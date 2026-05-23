import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

describe("RPC Methods", () => {
  let methodHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ai-workbench-methods-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    vi.resetModules();

    vi.doMock("../../src-engine/src/db/store.js", async (importOriginal) => {
      const actual = (await importOriginal()) as any;
      return {
        Store: vi.fn(function (this: unknown) {
          return new actual.Store(testDir);
        }),
      };
    });

    const mod = await import("../../src-engine/src/json-rpc/methods.js");
    methodHandlers = mod.methodHandlers;
    mod.setNotifyFn(() => {});
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function createRun(extra: Record<string, unknown> = {}): Promise<any> {
    return methodHandlers["run.create"]({
      workingDir: "/tmp/test",
      goals: ["goal 1"],
      terminationConditions: ["done when goal met"],
      ...extra,
    });
  }

  describe("run.list / run.create", () => {
    it("should list empty runs initially", async () => {
      const runs = await methodHandlers["run.list"]({});
      expect(runs).toEqual([]);
    });

    it("should create a run with tasks", async () => {
      const run = await createRun({
        tasks: [{ content: "task 1", type: "user_defined", priority: 1 }],
      });
      expect(run.id).toBeDefined();
      expect(run.status).toBe("idle");

      const runs = await methodHandlers["run.list"]({});
      expect(runs).toHaveLength(1);
    });

    it("should create a run without tasks", async () => {
      const run = await createRun();
      expect(run.id).toBeDefined();
      expect(run.goals).toEqual(["goal 1"]);
    });
  });

  describe("run.report", () => {
    it("should return run and report", async () => {
      const run = await createRun();
      const result = await methodHandlers["run.report"]({ runId: run.id });
      expect(result.run).toBeDefined();
      expect(result.report).toBeNull();
    });
  });

  describe("run.tasks", () => {
    it("should list tasks for a run", async () => {
      const run = await createRun({
        tasks: [{ content: "task 1", type: "user_defined", priority: 1 }],
      });
      const tasks = await methodHandlers["run.tasks"]({ runId: run.id });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].content).toBe("task 1");
    });
  });

  describe("run.commits", () => {
    it("should return empty commits for a run", async () => {
      const run = await createRun();
      const commits = await methodHandlers["run.commits"]({ runId: run.id });
      expect(commits).toEqual([]);
    });
  });

  describe("run.lessons", () => {
    it("should return empty lessons for a run", async () => {
      const run = await createRun();
      const lessons = await methodHandlers["run.lessons"]({ runId: run.id });
      expect(lessons).toEqual([]);
    });
  });

  describe("run.stop", () => {
    it("should stop a run and mark as paused", async () => {
      const run = await createRun();
      const result = await methodHandlers["run.stop"]({ runId: run.id });
      expect(result.status).toBe("stopped");
    });
  });

  describe("run.delete", () => {
    it("should delete a run", async () => {
      const run = await createRun();
      const result = await methodHandlers["run.delete"]({ runId: run.id });
      expect(result.deleted).toBe(true);
      const runs = await methodHandlers["run.list"]({});
      expect(runs).toHaveLength(0);
    });
  });

  describe("task.create validation", () => {
    it("should reject empty content", async () => {
      const run = await createRun();
      await expect(methodHandlers["task.create"]({
        runId: run.id,
        content: "",
        type: "user_defined",
        priority: 1,
      })).rejects.toThrow("content is required");
    });

    it("should reject invalid runId", async () => {
      await expect(methodHandlers["task.create"]({
        runId: "nonexistent",
        content: "test task",
        type: "user_defined",
        priority: 1,
      })).rejects.toThrow("Run not found");
    });

    it("should create a task in a valid run", async () => {
      const run = await createRun();
      const task = await methodHandlers["task.create"]({
        runId: run.id,
        content: "Implement feature X",
        type: "user_defined",
        priority: 1,
      });
      expect(task.content).toBe("Implement feature X");
      expect(task.runId).toBe(run.id);
    });
  });

  describe("task.start", () => {
    it("should reject nonexistent run", async () => {
      await expect(methodHandlers["task.start"]({ runId: "nonexistent" }))
        .rejects.toThrow("not found");
    });

    it("should reject completed run", async () => {
      const run = await createRun();
      // Mark as completed directly in the store
      const store = new (await import("../../src-engine/src/db/store.js")).Store(testDir) as any;
      run.status = "completed";
      store.saveRun(run);

      await expect(methodHandlers["task.start"]({ runId: run.id }))
        .rejects.toThrow("already completed");
    });

    it("should start a run and set status to running", async () => {
      const run = await createRun();
      const result = await methodHandlers["task.start"]({ runId: run.id });
      expect(result.status).toBe("running");
    });

    it("should reject duplicate executor for same run", async () => {
      const run = await createRun();
      await methodHandlers["task.start"]({ runId: run.id });
      await expect(methodHandlers["task.start"]({ runId: run.id }))
        .rejects.toThrow("already has an active executor");
      await methodHandlers["run.stop"]({ runId: run.id });
    });
  });

  describe("task.pause", () => {
    it("should pause a running run", async () => {
      const run = await createRun();
      await methodHandlers["task.start"]({ runId: run.id });
      const result = await methodHandlers["task.pause"]({ runId: run.id });
      expect(result.status).toBe("paused");
    });
  });

  describe("task.resume", () => {
    it("should resume a paused run", async () => {
      const run = await createRun();
      await methodHandlers["task.start"]({ runId: run.id });
      await methodHandlers["task.pause"]({ runId: run.id });
      const result = await methodHandlers["task.resume"]({ runId: run.id });
      expect(result.status).toBe("running");
      await methodHandlers["run.stop"]({ runId: run.id });
    });
  });

  describe("task.cancel", () => {
    it("should cancel a task", async () => {
      const result = await methodHandlers["task.cancel"]({ taskId: "t1", runId: "r1" });
      expect(result.status).toBe("cancelled");
    });
  });

  describe("task.setTimeout", () => {
    it("should reject timeout outside bounds", async () => {
      await expect(methodHandlers["task.setTimeout"]({
        runId: "r1", taskId: "t1", minutes: 0,
      })).rejects.toThrow("between 1 and 1440");

      await expect(methodHandlers["task.setTimeout"]({
        runId: "r1", taskId: "t1", minutes: 2000,
      })).rejects.toThrow("between 1 and 1440");
    });

    it("should set timeout for valid minutes", async () => {
      const run = await createRun();
      const task = await methodHandlers["task.create"]({
        runId: run.id,
        content: "Test task",
        type: "user_defined",
        priority: 1,
      });
      const result = await methodHandlers["task.setTimeout"]({
        runId: run.id, taskId: task.id, minutes: 30,
      });
      expect(result.timeoutMinutes).toBe(30);
    });
  });

  describe("queue.list", () => {
    it("should list queue for a run", async () => {
      const run = await createRun({
        tasks: [{ content: "task 1", type: "user_defined", priority: 1 }],
      });
      const result = await methodHandlers["queue.list"]({ runId: run.id });
      expect(result.queue).toBeDefined();
      expect(result.runId).toBe(run.id);
    });
  });

  describe("queue.reorder", () => {
    it("should reject empty taskIds", async () => {
      await expect(methodHandlers["queue.reorder"]({ runId: "r1", taskIds: [] }))
        .rejects.toThrow("non-empty array");
      await expect(methodHandlers["queue.reorder"]({ runId: "r1" }))
        .rejects.toThrow("non-empty array");
    });

    it("should reorder tasks", async () => {
      const run = await createRun({
        tasks: [
          { content: "task 1", type: "user_defined", priority: 1 },
          { content: "task 2", type: "user_defined", priority: 2 },
        ],
      });
      const queue = await methodHandlers["queue.list"]({ runId: run.id });
      const ids = queue.queue.map((t: any) => t.id).reverse();
      const result = await methodHandlers["queue.reorder"]({ runId: run.id, taskIds: ids });
      expect(result.order).toEqual(ids);
    });
  });

  describe("wizard.start", () => {
    it("should start a wizard session", async () => {
      const result = await methodHandlers["wizard.start"]({ workingDir: "/tmp/test" });
      expect(result.sessionId).toBeDefined();
      expect(result.workingDir).toBe("/tmp/test");
    });
  });

  describe("wizard.validate", () => {
    it("should validate a wizard session with fallback params", async () => {
      const session = await methodHandlers["wizard.start"]({ workingDir: "/tmp/test" });
      const result = await methodHandlers["wizard.validate"]({ sessionId: session.sessionId });
      // Fallback params from empty session are actually valid (non-empty content, goals, conditions)
      expect(result.valid).toBe(true);
      expect(result.params).toBeDefined();
    });
  });

  describe("config.get / config.set", () => {
    it("should get and set config values", async () => {
      await methodHandlers["config.set"]({ key: "testKey", value: "hello" });
      const result = await methodHandlers["config.get"]({ key: "testKey" });
      expect(result.value).toBe("hello");
    });

    it("should return undefined for unknown keys", async () => {
      const result = await methodHandlers["config.get"]({ key: "nonexistent" });
      expect(result.value).toBeUndefined();
    });
  });
});
