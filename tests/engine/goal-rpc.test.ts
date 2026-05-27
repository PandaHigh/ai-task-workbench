import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import type { ExecutionRun } from "../../shared/src/task-types";

describe("RPC Methods — Unified Goal Lifecycle", () => {
  let methodHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;
  let testDir: string;
  let notifications: Array<{ method: string; params: Record<string, unknown> }>;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ai-workbench-goal-rpc-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    notifications = [];

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
      CCClient: vi.fn().mockImplementation(() => ({
        executeTask: vi.fn().mockResolvedValue({
          result: JSON.stringify({ achieved: false, reason: "mock", evidence: [], progress: 0.5, nextSteps: "" }),
          sessionId: "mock-session",
          durationMs: 100,
          totalCostUsd: 0.01,
        }),
      })),
    }));

    const mod = await import("../../src-engine/src/json-rpc/methods.js");
    methodHandlers = mod.methodHandlers;
    mod.setNotifyFn((method: string, params: Record<string, unknown>) => {
      notifications.push({ method, params });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  async function createRun(extra: Record<string, unknown> = {}): Promise<ExecutionRun> {
    return methodHandlers["run.create"]({
      workingDir: "/tmp/test",
      goals: ["goal 1"],
      terminationConditions: ["done when goal met"],
      ...extra,
    }) as Promise<ExecutionRun>;
  }

  async function initGoalState(runId: string): Promise<void> {
    const storeMod = await import("../../src-engine/src/db/store.js");
    const store = new storeMod.Store(testDir);
    const run = store.getRun(runId);
    if (run) {
      run.goalStatus = "pursuing";
      run.goalBudgetTokens = 500_000;
      run.goalTokensUsed = 0;
      run.goalTimeStartedAt = Date.now();
      run.goalTimeElapsedMs = 0;
      run.goalEvaluationCycles = 0;
      run.goalLastEvalReason = "";
      run.goalEvidence = [];
      store.saveRun(run);
    }
  }

  describe("run.pauseGoal", () => {
    it("should pause a pursuing goal", async () => {
      const run = await createRun();
      await initGoalState(run.id);
      const result = await methodHandlers["run.pauseGoal"]({ runId: run.id }) as { goalStatus: string };
      expect(result.goalStatus).toBe("paused");

      // Verify persistence
      const storeMod = await import("../../src-engine/src/db/store.js");
      const store = new storeMod.Store(testDir);
      const persisted = store.getRun(run.id);
      expect(persisted?.goalStatus).toBe("paused");
    });

    it("should broadcast goal.updated on pause", async () => {
      const run = await createRun();
      await initGoalState(run.id);
      notifications.length = 0;
      await methodHandlers["run.pauseGoal"]({ runId: run.id });

      const goalNotifs = notifications.filter((n) => n.method === "goal.updated");
      expect(goalNotifs.length).toBeGreaterThanOrEqual(1);
      expect(goalNotifs[0].params.runId).toBe(run.id);
      expect((goalNotifs[0].params.goal as Record<string, unknown>).status).toBe("paused");
    });

    it("should reject when no pursuing goal", async () => {
      const run = await createRun();
      await expect(methodHandlers["run.pauseGoal"]({ runId: run.id }))
        .rejects.toThrow("No pursuing goal");
    });

    it("should reject non-existent run", async () => {
      await expect(methodHandlers["run.pauseGoal"]({ runId: "nonexistent" }))
        .rejects.toThrow("Run not found");
    });

    it("should reject missing runId", async () => {
      await expect(methodHandlers["run.pauseGoal"]({}))
        .rejects.toThrow("Missing required parameter: runId");
    });
  });

  describe("run.resumeGoal", () => {
    it("should resume a paused goal", async () => {
      const run = await createRun();
      await initGoalState(run.id);
      await methodHandlers["run.pauseGoal"]({ runId: run.id });
      const result = await methodHandlers["run.resumeGoal"]({ runId: run.id }) as { goalStatus: string };
      expect(result.goalStatus).toBe("pursuing");

      // Verify persistence
      const storeMod = await import("../../src-engine/src/db/store.js");
      const store = new storeMod.Store(testDir);
      const persisted = store.getRun(run.id);
      expect(persisted?.goalStatus).toBe("pursuing");
    });

    it("should reject when no paused goal", async () => {
      const run = await createRun();
      await expect(methodHandlers["run.resumeGoal"]({ runId: run.id }))
        .rejects.toThrow("No paused goal");
    });

    it("should broadcast goal.updated on resume", async () => {
      const run = await createRun();
      await initGoalState(run.id);
      await methodHandlers["run.pauseGoal"]({ runId: run.id });
      notifications.length = 0;
      await methodHandlers["run.resumeGoal"]({ runId: run.id });

      const goalNotifs = notifications.filter((n) => n.method === "goal.updated");
      expect(goalNotifs.length).toBeGreaterThanOrEqual(1);
      expect((goalNotifs[0].params.goal as Record<string, unknown>).status).toBe("pursuing");
    });
  });

  describe("run.clearGoal", () => {
    it("should clear an active goal", async () => {
      const run = await createRun();
      await initGoalState(run.id);
      const result = await methodHandlers["run.clearGoal"]({ runId: run.id }) as { cleared: boolean };
      expect(result.cleared).toBe(true);

      // Verify persistence — goal state reset to unmet
      const storeMod = await import("../../src-engine/src/db/store.js");
      const store = new storeMod.Store(testDir);
      const persisted = store.getRun(run.id);
      expect(persisted?.goalStatus).toBe("unmet");
      expect(persisted?.goalEvidence).toEqual([]);
    });

    it("should reject when no active goal", async () => {
      const run = await createRun();
      await expect(methodHandlers["run.clearGoal"]({ runId: run.id }))
        .rejects.toThrow("No active goal");
    });

    it("should broadcast goal.updated on clear", async () => {
      const run = await createRun();
      await initGoalState(run.id);
      notifications.length = 0;
      await methodHandlers["run.clearGoal"]({ runId: run.id });

      const goalNotifs = notifications.filter((n) => n.method === "goal.updated");
      expect(goalNotifs.length).toBeGreaterThanOrEqual(1);
      expect((goalNotifs[0].params.goal as Record<string, unknown>).status).toBe("unmet");
    });
  });

  describe("lifecycle integration", () => {
    it("should support full pursue → pause → resume → clear lifecycle with persistence", async () => {
      const run = await createRun();
      const storeMod = await import("../../src-engine/src/db/store.js");

      // Init goal state (simulating what executor.start() does)
      await initGoalState(run.id);

      // Verify initial state persisted
      let store = new storeMod.Store(testDir);
      let persisted = store.getRun(run.id);
      expect(persisted?.goalStatus).toBe("pursuing");

      // Pause
      const pauseResult = await methodHandlers["run.pauseGoal"]({ runId: run.id }) as { goalStatus: string };
      expect(pauseResult.goalStatus).toBe("paused");

      // Cannot pause again
      await expect(methodHandlers["run.pauseGoal"]({ runId: run.id }))
        .rejects.toThrow("No pursuing goal");

      // Resume
      const resumeResult = await methodHandlers["run.resumeGoal"]({ runId: run.id }) as { goalStatus: string };
      expect(resumeResult.goalStatus).toBe("pursuing");

      // Clear
      const clearResult = await methodHandlers["run.clearGoal"]({ runId: run.id }) as { cleared: boolean };
      expect(clearResult.cleared).toBe(true);

      // Cannot clear again (status is now "unmet")
      await expect(methodHandlers["run.clearGoal"]({ runId: run.id }))
        .rejects.toThrow("No active goal");
    });

    it("should persist goal state across simulated restart", async () => {
      const run = await createRun();
      await initGoalState(run.id);

      // Pause
      await methodHandlers["run.pauseGoal"]({ runId: run.id });

      // Verify persistence by reading from a fresh store instance
      const storeMod = await import("../../src-engine/src/db/store.js");
      const freshStore = new storeMod.Store(testDir);
      const persisted = freshStore.getRun(run.id);

      expect(persisted).toBeDefined();
      expect(persisted!.goalStatus).toBe("paused");
      expect(persisted!.goalBudgetTokens).toBe(500_000);
      expect(persisted!.goalEvidence).toEqual([]);
    });
  });
});
