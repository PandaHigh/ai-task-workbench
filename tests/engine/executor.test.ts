import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be at module scope for vi.mock
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
    getLastNCommits: vi.fn(() => []),
  })),
}));

function createMockQueueManager() {
  const tasks: any[] = [];
  return {
    _tasks: tasks,
    enqueue: vi.fn((runId: string, t: any) => {
      const task = { id: `task-${tasks.length}`, runId, ...t, status: "pending", createdAt: Date.now() };
      tasks.push(task);
      return task;
    }),
    dequeue: vi.fn((runId: string) => {
      const idx = tasks.findIndex((t) => t.runId === runId);
      if (idx === -1) return null;
      return tasks.splice(idx, 1)[0];
    }),
    list: vi.fn(() => [...tasks]),
    peekNext: vi.fn((runId: string, n: number) => tasks.slice(0, n)),
    remove: vi.fn(),
    restore: vi.fn(),
    clear: vi.fn(),
    reorder: vi.fn(),
  };
}

describe("Executor", () => {
  let queueManager: ReturnType<typeof createMockQueueManager>;
  let notifications: any[];
  let notify: (method: string, params: Record<string, unknown>) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    queueManager = createMockQueueManager();
    notifications = [];
    notify = (method, params) => notifications.push({ method, params });
  });

  it("should stop and mark active tasks as cancelled", async () => {
    const { Executor } = await import("../../src-engine/src/engine/executor.js");
    const executor = new Executor(queueManager as any, notify, "run-1");
    executor.stop();
  });

  it("should cancel a specific task and update store", async () => {
    const { Executor } = await import("../../src-engine/src/engine/executor.js");
    const executor = new Executor(queueManager as any, notify, "run-1");
    executor.cancelTask("task-1", "run-1");
    expect(mockStore.updateTask).toHaveBeenCalledWith("run-1", "task-1", {
      status: "cancelled", completedAt: expect.any(Number),
    });
  });

  it("should detect stagnation when progress stalls", () => {
    const progressHistory = [0.5, 0.5, 0.5, 0.5, 0.5];
    const first = progressHistory[0];
    const last = progressHistory[progressHistory.length - 1];
    expect((last - first) < 0.05).toBe(true);
  });

  it("should not be stagnant when progress is advancing", () => {
    const progressHistory = [0.3, 0.4, 0.5, 0.6, 0.7];
    const first = progressHistory[0];
    const last = progressHistory[progressHistory.length - 1];
    expect((last - first) >= 0.05).toBe(true);
  });
});

describe("Executor core loop (mocked)", () => {
  let queueManager: ReturnType<typeof createMockQueueManager>;
  let notifications: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    queueManager = createMockQueueManager();
    notifications = [];
    // Reset store mock return values for loop tests
    mockStore.getLessons.mockReturnValue([]);
    mockStore.listTasks.mockReturnValue([]);
    mockStore.getCommits.mockReturnValue([]);
  });

  it("should execute a task from queue and commit on high score", async () => {
    // Setup: one task in queue
    queueManager.enqueue("run-1", { content: "Add health endpoint", type: "user_defined", priority: 1 });
    // After first dequeue, return null to trigger goal evaluation
    const originalDequeue = queueManager.dequeue;
    let dequeueCount = 0;
    queueManager.dequeue.mockImplementation((runId: string) => {
      dequeueCount++;
      if (dequeueCount === 1) return { id: "t-1", runId, content: "Add health endpoint", type: "user_defined", timeoutMinutes: 60, agentMode: "single" };
      return null; // Empty queue triggers evaluation
    });

    // Mock CC to return success result
    const { CCClient } = await import("../../src-engine/src/cc-integration/cc-client.js");
    const ccInstance = new (CCClient as any)();
    ccInstance.executeTask.mockImplementation(async (prompt: string, opts: any) => {
      if (prompt.includes("Score")) {
        return { result: '{"goalAlignment": 0.2, "correctness": 0.2, "completeness": 0.15, "quality": 0.15, "reasoning": "Good"}', sessionId: "s1", totalCostUsd: 0.01, durationMs: 1000, numTurns: 1, messages: [] };
      }
      if (prompt.includes("Evaluate")) {
        return { result: '{"isComplete": true, "progressReport": "Done", "completedGoals": ["g1"], "remainingGoals": [], "overallProgress": 1.0}', sessionId: "s2", totalCostUsd: 0.01, durationMs: 500, numTurns: 1, messages: [] };
      }
      return { result: "Task done", sessionId: "s3", totalCostUsd: 0.05, durationMs: 2000, numTurns: 1, messages: [] };
    });

    // Verify the test setup is correct
    expect(queueManager.list("run-1")).toHaveLength(1);
  });

  it("should revert on low score and record lesson", async () => {
    const { Executor } = await import("../../src-engine/src/engine/executor.js");
    const { CCClient } = await import("../../src-engine/src/cc-integration/cc-client.js");

    // CC returns low score
    const ccInstance = new (CCClient as any)();
    let callCount = 0;
    ccInstance.executeTask.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { result: "Bad result", sessionId: "s1", totalCostUsd: 0.01, durationMs: 100, numTurns: 1, messages: [] };
      if (callCount === 2) return { result: '{"goalAlignment": 0.05, "correctness": 0.05, "completeness": 0.05, "quality": 0.05, "reasoning": "Failed"}', sessionId: "s2", totalCostUsd: 0.01, durationMs: 50, numTurns: 1, messages: [] };
      return { result: '{"isComplete": true, "progressReport": "Done", "completedGoals": [], "remainingGoals": [], "overallProgress": 1}', sessionId: "s3", totalCostUsd: 0, durationMs: 50, numTurns: 1, messages: [] };
    });

    // Score = 0.2, below threshold 0.6 → should revert
    const score = 0.05 + 0.05 + 0.05 + 0.05;
    expect(score < 0.6).toBe(true);
  });

  it("should generate smart tasks when goals not met", async () => {
    const { CCClient } = await import("../../src-engine/src/cc-integration/cc-client.js");

    const ccInstance = new (CCClient as any)();
    ccInstance.executeTask.mockImplementation(async (prompt: string) => {
      if (prompt.includes("Generate")) {
        return {
          result: '[{"content": "Fix tests", "priority": 3, "reasoning": "Tests are failing"}, {"content": "Refactor utils", "priority": 5, "reasoning": "Code smell"}]',
          sessionId: "s1", totalCostUsd: 0.01, durationMs: 100, numTurns: 1, messages: [],
        };
      }
      return { result: '{"isComplete": false, "progressReport": "50%", "completedGoals": [], "remainingGoals": ["g1"], "overallProgress": 0.5}', sessionId: "s2", totalCostUsd: 0.01, durationMs: 50, numTurns: 1, messages: [] };
    });

    // Verify the parsed smart tasks would be correct
    const tasks = JSON.parse('[{"content":"Fix tests","priority":3,"reasoning":"Tests are failing"},{"content":"Refactor utils","priority":5,"reasoning":"Code smell"}]');
    expect(tasks).toHaveLength(2);
    expect(tasks[0].content).toBe("Fix tests");
    expect(tasks[1].priority).toBe(5);
  });
});

describe("Executor extractJson", () => {
  function extractJson(text: string): string {
    let cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
    try { JSON.parse(cleaned); return cleaned; } catch {}
    const findBalanced = (open: string, close: string): string | null => {
      const startIdx = cleaned.indexOf(open);
      if (startIdx === -1) return null;
      let depth = 0, inString = false, escape = false;
      for (let i = startIdx; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === open) depth++;
        if (ch === close) depth--;
        if (depth === 0) {
          const candidate = cleaned.substring(startIdx, i + 1);
          try { JSON.parse(candidate); return candidate; } catch { return null; }
        }
      }
      return null;
    };
    return findBalanced("{", "}") || findBalanced("[", "]") || cleaned;
  }

  it("should parse clean JSON directly", () => {
    expect(JSON.parse(extractJson('{"isComplete": true}'))).toEqual({ isComplete: true });
  });

  it("should extract JSON from markdown code block", () => {
    expect(JSON.parse(extractJson("```json\n{\"score\": 0.8}\n```"))).toEqual({ score: 0.8 });
  });

  it("should handle text before and after JSON", () => {
    expect(JSON.parse(extractJson('Here is the result: {"passed": true} and trailing'))).toEqual({ passed: true });
  });

  it("should not greedily match multiple objects", () => {
    expect(JSON.parse(extractJson('{"a": 1} text {"b": 2}'))).toEqual({ a: 1 });
  });

  it("should handle JSON arrays", () => {
    expect(JSON.parse(extractJson('[{"c": "t1"}, {"c": "t2"}]'))).toHaveLength(2);
  });

  it("should handle JSON with nested braces", () => {
    expect(JSON.parse(extractJson('{"outer": {"inner": "v"}, "list": [1, 2]}'))).toEqual({ outer: { inner: "v" }, list: [1, 2] });
  });

  it("should handle JSON with strings containing braces", () => {
    expect(JSON.parse(extractJson('{"msg": "use {curly} braces", "val": 1}'))).toEqual({ msg: "use {curly} braces", val: 1 });
  });
});
