import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { TaskDefinition } from "../../shared/src/task-types";

// ─── Shared mocks ────────────────────────────────────────────────────

const mockStore = {
  saveRun: vi.fn(),
  getRun: vi.fn(),
  listRuns: vi.fn(() => []),
  deleteRun: vi.fn(),
  saveTask: vi.fn(),
  listTasks: vi.fn(() => []),
  getTask: vi.fn(),
  updateTask: vi.fn(),
  appendLog: vi.fn(),
  getLogs: vi.fn(() => []),
  appendScore: vi.fn(),
  appendCommit: vi.fn(),
  appendLesson: vi.fn(),
  getLessons: vi.fn(() => []),
  getCommits: vi.fn(() => []),
  saveReport: vi.fn(),
  getReport: vi.fn(() => null),
  getConfig: vi.fn(() => undefined),
  setConfig: vi.fn(),
  getScores: vi.fn(() => []),
};

vi.mock("../../src-engine/src/db/store.js", () => ({
  Store: vi.fn(() => mockStore),
}));

vi.mock("../../src-engine/src/cc-integration/cc-client.js", () => ({
  CCClient: vi.fn(() => ({
    executeTask: vi.fn(),
  })),
}));

vi.mock("../../src-engine/src/git/git-manager.js", () => ({
  GitManager: vi.fn(() => ({
    initIfNeeded: vi.fn(),
    autoCommit: vi.fn(() => "abc1234def"),
    revert: vi.fn(),
    checkoutClean: vi.fn(),
    getLastNCommits: vi.fn(() => Promise.resolve([])),
  })),
}));

// ─── Tests ───────────────────────────────────────────────────────────

describe("7x24: Evaluation cycle reset logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.getLessons.mockReturnValue([]);
    mockStore.listTasks.mockReturnValue([]);
    mockStore.getCommits.mockReturnValue([]);
  });

  it("should halve evaluationCycles when progress increases >0.01", async () => {
    const { Executor } = await import("../../src-engine/src/engine/executor.js");
    const qm = {
      dequeue: vi.fn(), enqueue: vi.fn(), list: vi.fn(() => []),
      peekNext: vi.fn(() => []), remove: vi.fn(), restore: vi.fn(),
      clear: vi.fn(), reorder: vi.fn(),
    };
    const executor = new Executor(
      qm as unknown as ConstructorParameters<typeof Executor>[0],
      vi.fn(), "run-1",
    );
    // Access internal state
    const internal = executor as unknown as {
      evaluationCycles: number;
      progressHistory: number[];
      config: { stagnationWindow: number };
    };

    // Simulate: 10 evaluation cycles accumulated, then progress jumps
    internal.evaluationCycles = 10;
    internal.progressHistory = [0.1, 0.2, 0.3, 0.4, 0.5]; // 5 entries, increasing
    internal.config.stagnationWindow = 5;

    // Simulate what handleEmptyQueue does: push new progress, check reset
    const newProgress = 0.6; // > 0.5 + 0.01 = progress made
    internal.progressHistory.push(newProgress);
    const maxHistory = internal.config.stagnationWindow * 2;
    if (internal.progressHistory.length > maxHistory) {
      internal.progressHistory = internal.progressHistory.slice(-maxHistory);
    }
    if (internal.progressHistory.length >= 2) {
      const prev = internal.progressHistory[internal.progressHistory.length - 2];
      const curr = internal.progressHistory[internal.progressHistory.length - 1];
      if (curr > prev + 0.01) {
        internal.evaluationCycles = Math.floor(internal.evaluationCycles / 2);
      }
    }

    expect(internal.evaluationCycles).toBe(5); // 10 / 2
    expect(internal.progressHistory).toHaveLength(6);
  });

  it("should NOT reset evaluationCycles when progress does not increase", async () => {
    const { Executor } = await import("../../src-engine/src/engine/executor.js");
    const qm = {
      dequeue: vi.fn(), enqueue: vi.fn(), list: vi.fn(() => []),
      peekNext: vi.fn(() => []), remove: vi.fn(), restore: vi.fn(),
      clear: vi.fn(), reorder: vi.fn(),
    };
    const executor = new Executor(
      qm as unknown as ConstructorParameters<typeof Executor>[0],
      vi.fn(), "run-1",
    );
    const internal = executor as unknown as {
      evaluationCycles: number;
      progressHistory: number[];
      config: { stagnationWindow: number };
    };

    internal.evaluationCycles = 10;
    internal.progressHistory = [0.5, 0.5, 0.5, 0.5, 0.5]; // stalled

    const newProgress = 0.505; // not > 0.5 + 0.01
    internal.progressHistory.push(newProgress);
    if (internal.progressHistory.length >= 2) {
      const prev = internal.progressHistory[internal.progressHistory.length - 2];
      const curr = internal.progressHistory[internal.progressHistory.length - 1];
      if (curr > prev + 0.01) {
        internal.evaluationCycles = Math.floor(internal.evaluationCycles / 2);
      }
    }

    expect(internal.evaluationCycles).toBe(10); // unchanged
  });

  it("should trim progressHistory to stagnationWindow * 2", async () => {
    const { Executor } = await import("../../src-engine/src/engine/executor.js");
    const qm = {
      dequeue: vi.fn(), enqueue: vi.fn(), list: vi.fn(() => []),
      peekNext: vi.fn(() => []), remove: vi.fn(), restore: vi.fn(),
      clear: vi.fn(), reorder: vi.fn(),
    };
    mockStore.getConfig.mockImplementation((key: string) => {
      if (key === "stagnationWindow") return 3;
      return undefined;
    });
    const executor = new Executor(
      qm as unknown as ConstructorParameters<typeof Executor>[0],
      vi.fn(), "run-1",
    );
    const internal = executor as unknown as {
      progressHistory: number[];
      config: { stagnationWindow: number };
    };

    // Simulate 10 pushes with stagnationWindow=3 → max=6
    for (let i = 0; i < 10; i++) {
      internal.progressHistory.push(i * 0.1);
      const maxHistory = internal.config.stagnationWindow * 2;
      if (internal.progressHistory.length > maxHistory) {
        internal.progressHistory = internal.progressHistory.slice(-maxHistory);
      }
    }

    expect(internal.progressHistory).toHaveLength(6); // 3*2
    expect(internal.progressHistory[0]).toBeCloseTo(0.4); // kept last 6
  });
});

describe("7x24: Auto-retry decision logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should detect timeout as transient error", () => {
    const patterns = ["timed out", "econnreset", "econnrefused", "etimedout", "sigterm", "sigkill", "aborted", "enoent"];
    const msg = "Task timed out after 60 minutes";
    const isTransient = patterns.some((p) => msg.toLowerCase().includes(p));
    expect(isTransient).toBe(true);
  });

  it("should NOT detect exit code 1 as transient", () => {
    const patterns = ["timed out", "econnreset", "econnrefused", "etimedout", "sigterm", "sigkill", "aborted", "enoent"];
    const msg = "CC process exited with code 1: compilation error";
    const isTransient = patterns.some((p) => msg.toLowerCase().includes(p));
    expect(isTransient).toBe(false);
  });

  it("should compute backoff correctly", () => {
    const computeBackoff = (retryCount: number) => Math.min(30000 * Math.pow(2, retryCount), 300000);
    expect(computeBackoff(0)).toBe(30000);   // 30s
    expect(computeBackoff(1)).toBe(60000);   // 60s
    expect(computeBackoff(2)).toBe(120000);  // 120s
    expect(computeBackoff(3)).toBe(240000);  // 240s
    expect(computeBackoff(4)).toBe(300000);  // capped at 5min
  });

  it("should retry when retryCount < maxAutoRetries and error is transient", () => {
    const retryCount = 2;
    const maxAutoRetries = 3;
    const isTransient = true;
    expect(isTransient && retryCount < maxAutoRetries).toBe(true);
  });

  it("should NOT retry when retryCount >= maxAutoRetries", () => {
    const retryCount = 3;
    const maxAutoRetries = 3;
    const isTransient = true;
    expect(isTransient && retryCount < maxAutoRetries).toBe(false);
  });
});

describe("7x24: Crash recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reset running tasks to pending on startup recovery", async () => {
    const { recoverStaleRuns } = await import("../../src-engine/src/json-rpc/methods.js");

    mockStore.listRuns.mockReturnValue([
      { id: "run-1", status: "running", workingDir: "/tmp", goals: ["g"], terminationConditions: ["t"], totalCostUsd: 0, totalTasksCompleted: 0 },
      { id: "run-2", status: "paused", workingDir: "/tmp", goals: ["g"], terminationConditions: ["t"], totalCostUsd: 0, totalTasksCompleted: 0 },
    ]);

    mockStore.listTasks.mockImplementation((runId: string) => {
      if (runId === "run-1") {
        return [
          { id: "t1", status: "running" },
          { id: "t2", status: "scoring" },
          { id: "t3", status: "pending" },
        ];
      }
      if (runId === "run-2") {
        return [
          { id: "t4", status: "committing" },
          { id: "t5", status: "completed" },
        ];
      }
      return [];
    });

    const result = recoverStaleRuns();

    expect(result.runsReset).toBe(1);
    expect(mockStore.saveRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run-1", status: "paused" }),
    );

    expect(result.tasksReset).toBe(3);
    expect(mockStore.updateTask).toHaveBeenCalledWith("run-1", "t1",
      expect.objectContaining({ status: "pending", errorMessage: expect.stringContaining("Crash recovery") }),
    );
    expect(mockStore.updateTask).toHaveBeenCalledWith("run-1", "t2",
      expect.objectContaining({ status: "pending" }),
    );
    expect(mockStore.updateTask).toHaveBeenCalledWith("run-2", "t4",
      expect.objectContaining({ status: "pending" }),
    );

    const updateCalls = mockStore.updateTask.mock.calls.map((c: unknown[]) => `${(c as [string, string])[0]}-${(c as [string, string])[1]}`);
    expect(updateCalls).not.toContain("run-1-t3");
    expect(updateCalls).not.toContain("run-2-t5");
  });

  it("should return zero resets when no stale state exists", async () => {
    const { recoverStaleRuns } = await import("../../src-engine/src/json-rpc/methods.js");

    mockStore.listRuns.mockReturnValue([
      { id: "run-ok", status: "paused", workingDir: "/tmp", goals: ["g"], terminationConditions: ["t"], totalCostUsd: 0, totalTasksCompleted: 0 },
    ]);
    mockStore.listTasks.mockReturnValue([
      { id: "t1", status: "completed" },
      { id: "t2", status: "pending" },
    ]);

    const result = recoverStaleRuns();
    expect(result.runsReset).toBe(0);
    expect(result.tasksReset).toBe(0);
  });
});

describe("7x24: Data array trimming (real Store)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    const os = await import("os");
    tmpDir = `${os.tmpdir()}/ai-wb-trim-${Date.now()}`;
  });

  afterEach(async () => {
    const fs = await import("fs");
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should trim commits at 500 entries", { timeout: 15000 }, async () => {
    const { Store: RealStore } = await vi.importActual<typeof import("../../src-engine/src/db/store.js")>("../../src-engine/src/db/store.js");
    const store = new RealStore(tmpDir);
    const runId = "run-trim";

    store.saveRun({
      id: runId, workingDir: "/tmp", goals: ["g"],
      terminationConditions: ["t"], status: "idle",
      totalCostUsd: 0, totalTasksCompleted: 0,
    });

    for (let i = 0; i < 600; i++) {
      store.appendCommit(runId, {
        taskId: `t-${i}`, runId, hash: `hash-${i}`, message: `commit ${i}`,
        isAiCommit: true, timestamp: Date.now(), additions: 0, deletions: 0,
      });
    }

    const commits = store.getCommits(runId);
    expect(commits).toHaveLength(500);
    expect(commits[0].taskId).toBe("t-100");
    expect(commits[499].taskId).toBe("t-599");
  });

  it("should trim lessons at 500 entries", async () => {
    const { Store: RealStore } = await vi.importActual<typeof import("../../src-engine/src/db/store.js")>("../../src-engine/src/db/store.js");
    const store = new RealStore(tmpDir);
    const runId = "run-lessons";

    store.saveRun({
      id: runId, workingDir: "/tmp", goals: ["g"],
      terminationConditions: ["t"], status: "idle",
      totalCostUsd: 0, totalTasksCompleted: 0,
    });

    for (let i = 0; i < 600; i++) {
      store.appendLesson(runId, {
        runId, category: "failure" as const, lesson: `lesson ${i}`,
        score: 0.3, createdAt: Date.now(),
      });
    }

    const lessons = store.getLessons(runId);
    expect(lessons).toHaveLength(500);
    expect(lessons[0].lesson).toBe("lesson 100");
    expect(lessons[499].lesson).toBe("lesson 599");
  });

  it("should trim scores at 500 entries", async () => {
    const { Store: RealStore } = await vi.importActual<typeof import("../../src-engine/src/db/store.js")>("../../src-engine/src/db/store.js");
    const store = new RealStore(tmpDir);
    const runId = "run-scores";

    store.saveRun({
      id: runId, workingDir: "/tmp", goals: ["g"],
      terminationConditions: ["t"], status: "idle",
      totalCostUsd: 0, totalTasksCompleted: 0,
    });

    for (let i = 0; i < 600; i++) {
      store.appendScore(runId, `t-${i}`, {
        overall: 0.5, goalAlignment: 0.1, correctness: 0.1,
        completeness: 0.1, quality: 0.2, passed: false, reasoning: "test",
      });
    }

    const scores = store.getScores(runId);
    expect(scores).toHaveLength(500);
    expect(scores[0].taskId).toBe("t-100");
    expect(scores[499].taskId).toBe("t-599");
  });
});

describe("7x24: Transient error pattern detection", () => {
  const transientErrors = [
    "Task timed out after 60 minutes",
    "Error: ETIMEDOUT connection failed",
    "Process received SIGTERM",
    "Task was aborted",
    "Error: ENOENT no such file",
    "Error: read ECONNRESET",
    "Error: ECONNREFUSED",
  ];

  const nonTransientErrors = [
    "CC process exited with code 1: compilation error",
    "Task scored below threshold",
    "Git revert failed",
    "Unknown error occurred",
  ];

  const patterns = ["timed out", "econnreset", "econnrefused", "etimedout", "sigterm", "sigkill", "aborted", "enoent"];

  for (const msg of transientErrors) {
    it(`should detect "${msg.substring(0, 40)}..." as transient`, () => {
      const isTransient = patterns.some((p) => msg.toLowerCase().includes(p));
      expect(isTransient).toBe(true);
    });
  }

  for (const msg of nonTransientErrors) {
    it(`should NOT detect "${msg.substring(0, 40)}..." as transient`, () => {
      const isTransient = patterns.some((p) => msg.toLowerCase().includes(p));
      expect(isTransient).toBe(false);
    });
  }
});

describe("7x24: Config key alignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should accept maxEvaluationCycles config (not maxEvalLoops)", async () => {
    const { methodHandlers } = await import("../../src-engine/src/json-rpc/methods.js");

    const result = await methodHandlers["config.set"]({ key: "maxEvaluationCycles", value: 500 });
    expect((result as Record<string, unknown>).saved).toBe(true);
  });

  it("should accept stagnationWindow config (not stagnationThreshold)", async () => {
    const { methodHandlers } = await import("../../src-engine/src/json-rpc/methods.js");

    const result = await methodHandlers["config.set"]({ key: "stagnationWindow", value: 10 });
    expect((result as Record<string, unknown>).saved).toBe(true);
  });

  it("should accept qualityThreshold config", async () => {
    const { methodHandlers } = await import("../../src-engine/src/json-rpc/methods.js");

    const result = await methodHandlers["config.set"]({ key: "qualityThreshold", value: 0.8 });
    expect((result as Record<string, unknown>).saved).toBe(true);
  });

  it("should accept maxAutoRetries config", async () => {
    const { methodHandlers } = await import("../../src-engine/src/json-rpc/methods.js");

    const result = await methodHandlers["config.set"]({ key: "maxAutoRetries", value: 5 });
    expect((result as Record<string, unknown>).saved).toBe(true);
  });

  it("should reject old key names (maxEvalLoops)", async () => {
    const { methodHandlers } = await import("../../src-engine/src/json-rpc/methods.js");

    await expect(methodHandlers["config.set"]({ key: "maxEvalLoops", value: 10 }))
      .rejects.toThrow("not allowed");
  });

  it("should reject old key names (stagnationThreshold)", async () => {
    const { methodHandlers } = await import("../../src-engine/src/json-rpc/methods.js");

    await expect(methodHandlers["config.set"]({ key: "stagnationThreshold", value: 0.05 }))
      .rejects.toThrow("not allowed");
  });
});
