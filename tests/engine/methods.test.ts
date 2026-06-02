import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import type { ExecutionRun } from "../../shared/src/task-types";

describe("RPC Methods", () => {
  let methodHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ai-workbench-methods-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    vi.resetModules();

    vi.doMock("../../src-engine/src/db/store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/db/store.js")>();
      return {
        Store: vi.fn(function (this: unknown) {
          return new actual.Store(testDir);
        }),
      };
    });

    vi.doMock("../../src-engine/src/db/share-store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/db/share-store.js")>();
      return {
        ShareStore: vi.fn(function (this: unknown) {
          return new actual.ShareStore(testDir);
        }),
      };
    });

    vi.doMock("../../src-engine/src/db/subscription-store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/db/subscription-store.js")>();
      return {
        SubscriptionStore: vi.fn(function (this: unknown) {
          return new actual.SubscriptionStore(testDir);
        }),
      };
    });

    vi.doMock("../../src-engine/src/cc-integration/cc-client.js", () => ({
      CCClient: vi.fn(() => ({
        executeTask: vi.fn(async () => ({
          result: '{"isComplete": true, "progressReport": "Done", "completedGoals": ["g1"], "remainingGoals": [], "overallProgress": 1}',
          sessionId: "s-test", totalCostUsd: 0, durationMs: 0, numTurns: 0, messages: [],
        })),
      })),
    }));

    vi.doMock("../../src-engine/src/git/git-manager.js", () => ({
      GitManager: vi.fn(() => ({
        ensureInit: vi.fn(async () => {}),
        autoCommit: vi.fn(async () => "abc1234"),
        revert: vi.fn(async () => {}),
        checkoutClean: vi.fn(async () => {}),
        getLastNCommits: vi.fn(async () => []),
        getDiffStats: vi.fn(async () => ({ filesChanged: 0, linesChanged: 0, hasCriticalFiles: false })),
        push: vi.fn(async () => "Pushed"),
        pull: vi.fn(async () => "Pulled"),
        fetch: vi.fn(async () => "Fetched"),
        addRemote: vi.fn(async () => {}),
        listRemotes: vi.fn(async () => []),
        getCurrentBranch: vi.fn(async () => "main"),
      })),
    }));

    const mod = await import("../../src-engine/src/json-rpc/methods.js");
    methodHandlers = mod.methodHandlers;
    mod.setNotifyFn(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createRun(extra: Record<string, unknown> = {}): Promise<ExecutionRun> {
    return methodHandlers["run.create"]({
      workingDir: "/tmp/test",
      goals: ["goal 1"],
      terminationConditions: ["done when goal met"],
      ...extra,
    }) as Promise<ExecutionRun>;
  }

  // ─── Existing functional tests ─────────────────────────────────────────

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
      const result = await methodHandlers["run.report"]({ runId: run.id }) as Record<string, unknown>;
      expect(result.run).toBeDefined();
      expect(result.report).toBeNull();
    });
  });

  describe("run.tasks", () => {
    it("should list tasks for a run", async () => {
      const run = await createRun({
        tasks: [{ content: "task 1", type: "user_defined", priority: 1 }],
      });
      const tasks = await methodHandlers["run.tasks"]({ runId: run.id }) as unknown[];
      expect(tasks).toHaveLength(1);
      expect((tasks[0] as Record<string, unknown>).content).toBe("task 1");
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
      const result = await methodHandlers["run.stop"]({ runId: run.id }) as Record<string, unknown>;
      expect(result.status).toBe("stopped");
    });
  });

  describe("run.delete", () => {
    it("should delete a run", async () => {
      const run = await createRun();
      const result = await methodHandlers["run.delete"]({ runId: run.id }) as Record<string, unknown>;
      expect(result.deleted).toBe(true);
      const runs = await methodHandlers["run.list"]({});
      expect(runs).toHaveLength(0);
    });

    it("should clean up shares when deleting a run", async () => {
      const run = await createRun();
      await methodHandlers["share.create"]({ runId: run.id, label: "test share" });
      const sharesBefore = await methodHandlers["share.list"]({ runId: run.id }) as unknown[];
      expect(sharesBefore.length).toBeGreaterThanOrEqual(1);

      await methodHandlers["run.delete"]({ runId: run.id });

      const sharesAfter = await methodHandlers["share.list"]({ runId: run.id }) as unknown[];
      expect(sharesAfter).toHaveLength(0);
    });

    it("should clean up subscriptions when deleting a run", async () => {
      const run = await createRun();
      const { SubscriptionStore } = await import("../../src-engine/src/db/subscription-store.js");
      const subStore = new SubscriptionStore(testDir);
      subStore.subscribe({
        runId: run.id,
        remoteUrl: "http://localhost:9999",
        remoteToken: "tok-123",
        remoteRunId: "remote-run-1",
        label: "test sub",
      });
      const subsBefore = subStore.list();
      expect(subsBefore.length).toBeGreaterThanOrEqual(1);

      await methodHandlers["run.delete"]({ runId: run.id });

      const subsAfter = subStore.list();
      expect(subsAfter).toHaveLength(0);
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
      })).rejects.toThrow("non-empty string");
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
      }) as Record<string, unknown>;
      expect(task.content).toBe("Implement feature X");
      expect(task.runId).toBe(run.id);
    });

    it("should auto-restart executor when adding task to completed run", async () => {
      const run = await createRun();
      const { Store } = await import("../../src-engine/src/db/store.js");
      const store = new Store(testDir);

      // Mark run as completed
      run.status = "completed";
      run.completedAt = Date.now();
      run.finalReport = "All done";
      store.saveRun(run);

      // Add a new task to the completed run
      const task = await methodHandlers["task.create"]({
        runId: run.id,
        content: "New task after completion",
        type: "user_defined",
        priority: 1,
      }) as Record<string, unknown>;
      expect(task.content).toBe("New task after completion");

      // Verify run was reset to running
      const updatedRun = store.getRun(run.id);
      expect(updatedRun?.status).toBe("running");
      expect(updatedRun?.completedAt).toBeUndefined();
      expect(updatedRun?.finalReport).toBeUndefined();
    });

    it("should not auto-restart when adding task to idle run", async () => {
      const run = await createRun();
      // Run is idle by default
      expect(run.status).toBe("idle");

      await methodHandlers["task.create"]({
        runId: run.id,
        content: "Task for idle run",
        type: "user_defined",
        priority: 1,
      });

      const { Store } = await import("../../src-engine/src/db/store.js");
      const store = new Store(testDir);
      const updatedRun = store.getRun(run.id);
      // Should stay idle, not auto-start
      expect(updatedRun?.status).toBe("idle");
    });
  });

  describe("task.start", () => {
    it("should reject nonexistent run", async () => {
      await expect(methodHandlers["task.start"]({ runId: "nonexistent" }))
        .rejects.toThrow("not found");
    });

    it("should allow restarting completed run and reset state", async () => {
      const run = await createRun();
      const { Store } = await import("../../src-engine/src/db/store.js");
      const store = new Store(testDir);
      run.status = "completed";
      run.completedAt = Date.now();
      run.finalReport = "done";
      store.saveRun(run);

      const result = await methodHandlers["task.start"]({ runId: run.id }) as Record<string, unknown>;
      expect(result.status).toBe("running");

      // Verify completion state was cleared
      const updatedRun = store.getRun(run.id);
      expect(updatedRun?.completedAt).toBeUndefined();
      expect(updatedRun?.finalReport).toBeUndefined();
    });

    it("should allow restarting failed run", async () => {
      const run = await createRun();
      const { Store } = await import("../../src-engine/src/db/store.js");
      const store = new Store(testDir);
      run.status = "failed";
      store.saveRun(run);

      const result = await methodHandlers["task.start"]({ runId: run.id }) as Record<string, unknown>;
      expect(result.status).toBe("running");
    });

    it("should start a run and set status to running", async () => {
      const run = await createRun();
      const result = await methodHandlers["task.start"]({ runId: run.id }) as Record<string, unknown>;
      expect(result.status).toBe("running");
    });

    it("should reject duplicate executor for same run", async () => {
      const run = await createRun();
      await methodHandlers["task.start"]({ runId: run.id });
      await expect(methodHandlers["task.start"]({ runId: run.id }))
        .rejects.toThrow("already executing");
      await methodHandlers["run.stop"]({ runId: run.id });
    });
  });

  describe("task.pause", () => {
    it("should pause a running run", async () => {
      const run = await createRun();
      await methodHandlers["task.start"]({ runId: run.id });
      const result = await methodHandlers["task.pause"]({ runId: run.id }) as Record<string, unknown>;
      expect(result.status).toBe("paused");
    });
  });

  describe("task.resume", () => {
    it("should resume a paused run", async () => {
      const run = await createRun();
      await methodHandlers["task.start"]({ runId: run.id });
      await methodHandlers["task.pause"]({ runId: run.id });
      const result = await methodHandlers["task.resume"]({ runId: run.id }) as Record<string, unknown>;
      expect(result.status).toBe("running");
      await methodHandlers["run.stop"]({ runId: run.id });
    });
  });

  describe("task.cancel", () => {
    it("should cancel a task", async () => {
      const result = await methodHandlers["task.cancel"]({ taskId: "t1", runId: "r1" }) as Record<string, unknown>;
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
      }) as Record<string, unknown>;
      const result = await methodHandlers["task.setTimeout"]({
        runId: run.id, taskId: task.id, minutes: 30,
      }) as Record<string, unknown>;
      expect(result.timeoutMinutes).toBe(30);
    });
  });

  describe("queue.list", () => {
    it("should list queue for a run", async () => {
      const run = await createRun({
        tasks: [{ content: "task 1", type: "user_defined", priority: 1 }],
      });
      const result = await methodHandlers["queue.list"]({ runId: run.id }) as Record<string, unknown>;
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
      const queue = await methodHandlers["queue.list"]({ runId: run.id }) as Record<string, unknown[]>;
      const ids = (queue.queue as Record<string, unknown>[]).map((t) => t.id).reverse();
      const result = await methodHandlers["queue.reorder"]({ runId: run.id, taskIds: ids }) as Record<string, unknown>;
      expect(result.order).toEqual(ids);
    });
  });

  describe("wizard.start", () => {
    it("should start a wizard session", async () => {
      const result = await methodHandlers["wizard.start"]({ workingDir: "/tmp/test" }) as Record<string, unknown>;
      expect(result.sessionId).toBeDefined();
      expect(result.workingDir).toBe("/tmp/test");
    });
  });

  describe("wizard.validate", () => {
    it("should validate a wizard session with fallback params", async () => {
      const session = await methodHandlers["wizard.start"]({ workingDir: "/tmp/test" }) as Record<string, unknown>;
      const result = await methodHandlers["wizard.validate"]({ sessionId: session.sessionId }) as Record<string, unknown>;
      expect(result.valid).toBe(true);
      expect(result.params).toBeDefined();
    });
  });

  describe("config.get / config.set", () => {
    it("should get and set config values", async () => {
      await methodHandlers["config.set"]({ key: "defaultModel", value: "claude" });
      const result = await methodHandlers["config.get"]({ key: "defaultModel" }) as Record<string, unknown>;
      expect(result.value).toBe("claude");
    });

    it("should return undefined for unknown keys", async () => {
      const result = await methodHandlers["config.get"]({ key: "nonexistent" }) as Record<string, unknown>;
      expect(result.value).toBeUndefined();
    });
  });

  // ─── Input validation tests ────────────────────────────────────────────

  describe("Input validation — runId", () => {
    const RUN_METHODS_WITH_RUNID = [
      "run.report", "run.tasks", "run.commits", "run.lessons",
      "run.stop", "run.delete", "task.start", "task.pause",
      "task.resume", "queue.list",
    ];

    for (const method of RUN_METHODS_WITH_RUNID) {
      describe(`${method}`, () => {
        it("should reject missing runId", async () => {
          await expect(methodHandlers[method]({}))
            .rejects.toThrow("Missing required parameter: runId");
        });

        it("should reject null runId", async () => {
          await expect(methodHandlers[method]({ runId: null }))
            .rejects.toThrow("Missing required parameter: runId");
        });

        it("should reject non-string runId", async () => {
          await expect(methodHandlers[method]({ runId: 123 }))
            .rejects.toThrow("Parameter 'runId' must be a string");
        });
      });
    }

    it("should reject runId with path traversal (..)", async () => {
      await expect(methodHandlers["run.report"]({ runId: "../etc/passwd" }))
        .rejects.toThrow("invalid path characters");
      await expect(methodHandlers["run.tasks"]({ runId: "abc../def" }))
        .rejects.toThrow("invalid path characters");
    });

    it("should reject runId containing forward slash", async () => {
      await expect(methodHandlers["run.commits"]({ runId: "run/secret" }))
        .rejects.toThrow("invalid path characters");
    });

    it("should reject runId containing backslash", async () => {
      await expect(methodHandlers["run.lessons"]({ runId: "run\\secret" }))
        .rejects.toThrow("invalid path characters");
    });
  });

  describe("Input validation — task.cancel", () => {
    it("should reject missing taskId", async () => {
      await expect(methodHandlers["task.cancel"]({ runId: "r1" }))
        .rejects.toThrow("Missing required parameter: taskId");
    });

    it("should reject non-string taskId", async () => {
      await expect(methodHandlers["task.cancel"]({ runId: "r1", taskId: 42 }))
        .rejects.toThrow("Parameter 'taskId' must be a string");
    });

    it("should reject missing runId", async () => {
      await expect(methodHandlers["task.cancel"]({ taskId: "t1" }))
        .rejects.toThrow("Missing required parameter: runId");
    });
  });

  describe("Input validation — task.setTimeout", () => {
    it("should reject missing minutes", async () => {
      await expect(methodHandlers["task.setTimeout"]({ runId: "r1", taskId: "t1" }))
        .rejects.toThrow("between 1 and 1440");
    });

    it("should reject non-number minutes", async () => {
      await expect(methodHandlers["task.setTimeout"]({ runId: "r1", taskId: "t1", minutes: "abc" }))
        .rejects.toThrow("between 1 and 1440");
    });

    it("should reject NaN minutes", async () => {
      await expect(methodHandlers["task.setTimeout"]({ runId: "r1", taskId: "t1", minutes: NaN }))
        .rejects.toThrow("between 1 and 1440");
    });

    it("should reject Infinity minutes", async () => {
      await expect(methodHandlers["task.setTimeout"]({ runId: "r1", taskId: "t1", minutes: Infinity }))
        .rejects.toThrow("between 1 and 1440");
    });

    it("should reject missing runId", async () => {
      await expect(methodHandlers["task.setTimeout"]({ taskId: "t1", minutes: 10 }))
        .rejects.toThrow("Missing required parameter: runId");
    });

    it("should reject missing taskId", async () => {
      await expect(methodHandlers["task.setTimeout"]({ runId: "r1", minutes: 10 }))
        .rejects.toThrow("Missing required parameter: taskId");
    });
  });

  describe("Input validation — task.create", () => {
    it("should reject missing runId", async () => {
      await expect(methodHandlers["task.create"]({ content: "test", type: "user_defined", priority: 1 }))
        .rejects.toThrow("Missing required parameter: runId");
    });

    it("should reject missing content", async () => {
      await expect(methodHandlers["task.create"]({ runId: "r1", type: "user_defined", priority: 1 }))
        .rejects.toThrow("Missing required parameter: content");
    });

    it("should reject whitespace-only content", async () => {
      await expect(methodHandlers["task.create"]({ runId: "r1", content: "   ", type: "user_defined", priority: 1 }))
        .rejects.toThrow("non-empty string");
    });

    it("should reject non-string content", async () => {
      await expect(methodHandlers["task.create"]({ runId: "r1", content: 42, type: "user_defined", priority: 1 }))
        .rejects.toThrow("Parameter 'content' must be a string");
    });

    it("should reject runId with path traversal", async () => {
      await expect(methodHandlers["task.create"]({ runId: "../etc", content: "test" }))
        .rejects.toThrow("invalid path characters");
    });
  });

  describe("Input validation — queue.reorder", () => {
    it("should reject missing runId", async () => {
      await expect(methodHandlers["queue.reorder"]({ taskIds: ["a"] }))
        .rejects.toThrow("Missing required parameter: runId");
    });

    it("should reject non-string elements in taskIds", async () => {
      await expect(methodHandlers["queue.reorder"]({ runId: "r1", taskIds: [1, 2] }))
        .rejects.toThrow("taskIds[0] must be a string");
    });

    it("should reject runId with path traversal", async () => {
      await expect(methodHandlers["queue.reorder"]({ runId: "../etc", taskIds: ["a"] }))
        .rejects.toThrow("invalid path characters");
    });
  });

  describe("Input validation — run.create", () => {
    it("should reject missing workingDir", async () => {
      await expect(methodHandlers["run.create"]({ goals: ["g1"], terminationConditions: ["c1"] }))
        .rejects.toThrow("Missing required parameter: workingDir");
    });

    it("should reject empty workingDir", async () => {
      await expect(methodHandlers["run.create"]({ workingDir: "", goals: ["g1"], terminationConditions: ["c1"] }))
        .rejects.toThrow("non-empty string");
    });

    it("should reject missing goals", async () => {
      await expect(methodHandlers["run.create"]({ workingDir: "/tmp/t", terminationConditions: ["c1"] }))
        .rejects.toThrow("goals");
    });

    it("should reject empty goals array", async () => {
      await expect(methodHandlers["run.create"]({ workingDir: "/tmp/t", goals: [], terminationConditions: ["c1"] }))
        .rejects.toThrow("goals");
    });

    it("should reject missing terminationConditions", async () => {
      await expect(methodHandlers["run.create"]({ workingDir: "/tmp/t", goals: ["g1"] }))
        .rejects.toThrow("terminationConditions");
    });

    it("should reject empty terminationConditions array", async () => {
      await expect(methodHandlers["run.create"]({ workingDir: "/tmp/t", goals: ["g1"], terminationConditions: [] }))
        .rejects.toThrow("terminationConditions");
    });

    it("should reject non-array tasks", async () => {
      await expect(methodHandlers["run.create"]({ workingDir: "/tmp/t", goals: ["g1"], terminationConditions: ["c1"], tasks: "bad" }))
        .rejects.toThrow("tasks");
    });
  });

  describe("Input validation — wizard.start", () => {
    it("should reject missing workingDir", async () => {
      await expect(methodHandlers["wizard.start"]({}))
        .rejects.toThrow("Missing required parameter: workingDir");
    });

    it("should reject empty workingDir", async () => {
      await expect(methodHandlers["wizard.start"]({ workingDir: "" }))
        .rejects.toThrow("non-empty string");
    });
  });

  describe("Input validation — wizard.chat", () => {
    it("should reject missing sessionId", async () => {
      await expect(methodHandlers["wizard.chat"]({ message: "hi" }))
        .rejects.toThrow("Missing required parameter: sessionId");
    });

    it("should reject missing message", async () => {
      await expect(methodHandlers["wizard.chat"]({ sessionId: "s1" }))
        .rejects.toThrow("Missing required parameter: message");
    });

    it("should reject empty message", async () => {
      await expect(methodHandlers["wizard.chat"]({ sessionId: "s1", message: "" }))
        .rejects.toThrow("non-empty string");
    });
  });

  describe("Input validation — wizard.validate", () => {
    it("should reject missing sessionId", async () => {
      await expect(methodHandlers["wizard.validate"]({}))
        .rejects.toThrow("Missing required parameter: sessionId");
    });

    it("should reject non-string sessionId", async () => {
      await expect(methodHandlers["wizard.validate"]({ sessionId: 123 }))
        .rejects.toThrow("Parameter 'sessionId' must be a string");
    });
  });

  describe("Input validation — config.get", () => {
    it("should reject missing key", async () => {
      await expect(methodHandlers["config.get"]({}))
        .rejects.toThrow("Missing required parameter: key");
    });

    it("should reject non-string key", async () => {
      await expect(methodHandlers["config.get"]({ key: 42 }))
        .rejects.toThrow("Parameter 'key' must be a string");
    });
  });

  describe("Input validation — config.set", () => {
    it("should reject missing key", async () => {
      await expect(methodHandlers["config.set"]({ value: "v" }))
        .rejects.toThrow("Missing required parameter: key");
    });

    it("should reject disallowed key", async () => {
      await expect(methodHandlers["config.set"]({ key: "evilKey", value: "v" }))
        .rejects.toThrow("not allowed");
    });

    it("should allow known config keys", async () => {
      // defaultModel is in the allow list, no numeric constraints
      const result = await methodHandlers["config.set"]({ key: "defaultModel", value: "claude" }) as Record<string, unknown>;
      expect(result.saved).toBe(true);
    });

    it("should enforce numeric constraints on maxBudgetUsd", async () => {
      await expect(methodHandlers["config.set"]({ key: "maxBudgetUsd", value: -1 }))
        .rejects.toThrow("between 0 and Infinity");
      await expect(methodHandlers["config.set"]({ key: "maxBudgetUsd", value: "abc" }))
        .rejects.toThrow("finite number");
    });

    it("should accept valid numeric config", async () => {
      const result = await methodHandlers["config.set"]({ key: "maxBudgetUsd", value: 50 }) as Record<string, unknown>;
      expect(result.saved).toBe(true);
    });
  });

  describe("Path traversal protection across methods", () => {
    const METHODS_WITH_RUNID = [
      "run.report", "run.tasks", "run.commits", "run.lessons",
      "run.stop", "run.delete", "task.start", "task.pause",
      "task.resume", "queue.list",
    ];

    for (const method of METHODS_WITH_RUNID) {
      it(`${method} should reject runId with ".."`, async () => {
        await expect(methodHandlers[method]({ runId: "../etc/passwd" }))
          .rejects.toThrow("invalid path characters");
      });
    }
  });

  describe("task.update", () => {
    it("should update task content", async () => {
      const run = await createRun();
      const task = await methodHandlers["task.create"]({ runId: run.id, content: "original" }) as Record<string, unknown>;
      const updated = await methodHandlers["task.update"]({ runId: run.id, taskId: task.id, content: "updated content" }) as Record<string, unknown>;
      expect(updated.content).toBe("updated content");
    });

    it("should update task priority", async () => {
      const run = await createRun();
      const task = await methodHandlers["task.create"]({ runId: run.id, content: "test" }) as Record<string, unknown>;
      const updated = await methodHandlers["task.update"]({ runId: run.id, taskId: task.id, priority: 8 }) as Record<string, unknown>;
      expect(updated.priority).toBe(8);
    });

    it("should update task timeoutMinutes", async () => {
      const run = await createRun();
      const task = await methodHandlers["task.create"]({ runId: run.id, content: "test" }) as Record<string, unknown>;
      const updated = await methodHandlers["task.update"]({ runId: run.id, taskId: task.id, timeoutMinutes: 120 }) as Record<string, unknown>;
      expect(updated.timeoutMinutes).toBe(120);
    });

    it("should reject update for non-editable status", async () => {
      const run = await createRun();
      const task = await methodHandlers["task.create"]({ runId: run.id, content: "test" }) as Record<string, unknown>;
      const { store } = await import("../../src-engine/src/json-rpc/methods.js");
      store.updateTask(run.id, task.id as string, { status: "running" });
      await expect(
        methodHandlers["task.update"]({ runId: run.id, taskId: task.id, content: "nope" }),
      ).rejects.toThrow("Cannot edit task");
    });

    it("should reject unknown task", async () => {
      const run = await createRun();
      await expect(
        methodHandlers["task.update"]({ runId: run.id, taskId: "nonexistent", content: "x" }),
      ).rejects.toThrow("Task not found");
    });

    it("should reject update with no valid fields", async () => {
      const run = await createRun();
      const task = await methodHandlers["task.create"]({ runId: run.id, content: "test" }) as Record<string, unknown>;
      await expect(
        methodHandlers["task.update"]({ runId: run.id, taskId: task.id }),
      ).rejects.toThrow("No valid fields to update");
    });
  });

  // ─── Git Remote RPC Methods ────────────────────────────────────────

  describe("git.push", () => {
    it("should push to remote", async () => {
      const result = await methodHandlers["git.push"]({ workingDir: "/tmp/test-git-push", remote: "origin", branch: "main" }) as string;
      expect(result).toBe("Pushed");
    });

    it("should require workingDir", async () => {
      await expect(methodHandlers["git.push"]({})).rejects.toThrow("Missing required parameter");
    });
  });

  describe("git.pull", () => {
    it("should pull from remote", async () => {
      const result = await methodHandlers["git.pull"]({ workingDir: "/tmp/test-git-pull", remote: "origin", branch: "main" }) as string;
      expect(result).toBe("Pulled");
    });
  });

  describe("git.fetch", () => {
    it("should fetch from remote", async () => {
      const result = await methodHandlers["git.fetch"]({ workingDir: "/tmp/test-git-fetch", remote: "origin" }) as string;
      expect(result).toBe("Fetched");
    });
  });

  describe("git.addRemote", () => {
    it("should add a remote", async () => {
      const result = await methodHandlers["git.addRemote"]({ workingDir: "/tmp/test-git-addremote", name: "upstream", url: "git@github.com:org/repo.git" });
      expect((result as Record<string, unknown>).added).toBe(true);
    });

    it("should require name and url", async () => {
      await expect(methodHandlers["git.addRemote"]({ workingDir: "/tmp/test-git-addremote2" })).rejects.toThrow("Missing required parameter");
    });
  });

  describe("git.listRemotes", () => {
    it("should list remotes as array", async () => {
      const result = await methodHandlers["git.listRemotes"]({ workingDir: "/tmp/test-git-listremotes" });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("git.currentBranch", () => {
    it("should return current branch", async () => {
      const result = await methodHandlers["git.currentBranch"]({ workingDir: "/tmp/test-git-branch" }) as string;
      expect(result).toBe("main");
    });
  });

  // ─── Task Intervention RPC Methods ─────────────────────────────────

  describe("task.intervene", () => {
    it("should reject missing runId", async () => {
      await expect(methodHandlers["task.intervene"]({})).rejects.toThrow("Missing required parameter");
    });

    it("should reject invalid action", async () => {
      await expect(methodHandlers["task.intervene"]({ runId: "r1", taskId: "t1", action: "fly" }))
        .rejects.toThrow("action must be");
    });
  });

  describe("task.inject", () => {
    it("should reject missing runId", async () => {
      await expect(methodHandlers["task.inject"]({})).rejects.toThrow("Missing required parameter");
    });

    it("should reject missing message", async () => {
      await expect(methodHandlers["task.inject"]({ runId: "r1", taskId: "t1" }))
        .rejects.toThrow("Missing required parameter");
    });
  });

  // ─── config.set with new keys ──────────────────────────────────────

  describe("config.set advanced keys", () => {
    it("should accept maxConcurrentTasks", async () => {
      const result = await methodHandlers["config.set"]({ key: "maxConcurrentTasks", value: 3 });
      expect((result as Record<string, unknown>).saved).toBe(true);
    });

    it("should accept autonomyLevel", async () => {
      const result = await methodHandlers["config.set"]({ key: "autonomyLevel", value: "supervised" });
      expect((result as Record<string, unknown>).saved).toBe(true);
    });

    it("should accept any string autonomyLevel", async () => {
      const result = await methodHandlers["config.set"]({ key: "autonomyLevel", value: "autonomous" });
      expect((result as Record<string, unknown>).saved).toBe(true);
    });

    it("should reject invalid maxConcurrentTasks (negative)", async () => {
      await expect(methodHandlers["config.set"]({ key: "maxConcurrentTasks", value: -1 }))
        .rejects.toThrow("must be between");
    });

    it("should reject invalid maxConcurrentTasks (too large)", async () => {
      await expect(methodHandlers["config.set"]({ key: "maxConcurrentTasks", value: 11 }))
        .rejects.toThrow("must be between");
    });

    it("should reject unknown config key", async () => {
      await expect(methodHandlers["config.set"]({ key: "unknownKey", value: "x" }))
        .rejects.toThrow("not allowed");
    });
  });

});
