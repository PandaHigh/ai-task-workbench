import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import type { TaskDefinition, ExecutionRun } from "../../shared/src/task-types";

// ─── Shared mocks (used by first two describe blocks) ────────────────────────

const mockExecuteTask = vi.fn();

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
  syncTraces: vi.fn(),
};

vi.mock("../../src-engine/src/db/store.js", () => ({
  Store: vi.fn(() => mockStore),
}));

vi.mock("../../src-engine/src/cc-integration/cc-client.js", () => ({
  CCClient: vi.fn(() => ({
    executeTask: mockExecuteTask,
  })),
}));

vi.mock("../../src-engine/src/git/git-manager.js", () => ({
  GitManager: vi.fn(() => ({
    initIfNeeded: vi.fn(),
    ensureInit: vi.fn(),
    autoCommit: vi.fn(() => "abc1234def"),
    revert: vi.fn(),
    checkoutClean: vi.fn(),
    getLastNCommits: vi.fn(() => []),
    getDiffStats: vi.fn(() => ({ filesChanged: 0, linesChanged: 0, hasCriticalFiles: false })),
  })),
}));

vi.mock("../../src-engine/src/git/branch-strategy.js", () => ({
  BranchStrategy: {
    createTaskBranch: vi.fn(() => Promise.resolve({ branchName: "feature/test", worktreePath: "/tmp/wt" })),
    cleanupBranch: vi.fn(() => Promise.resolve()),
    mergeBranch: vi.fn(() => Promise.resolve({ success: true })),
  },
}));

vi.mock("../../src-engine/src/skills/skill-manager.js", () => ({
  SkillManager: vi.fn(() => ({
    prepareWorkingDir: vi.fn(),
  })),
}));

vi.mock("../../src-engine/src/skills/claude-md-generator.js", () => ({
  generateClaudeMd: vi.fn(),
}));

vi.mock("../../src-engine/src/engine/omx-state.js", () => ({
  OmxAmpStateStore: vi.fn(() => ({
    save: vi.fn(),
    load: vi.fn(() => null),
    updateStage: vi.fn(),
    getResumableIndex: vi.fn(() => -1),
    getStages: vi.fn(() => ["deep-interview", "ralplan", "ultragoal", "code-review", "ultraqa"]),
    getStageIndex: vi.fn(() => 1),
    resetStage: vi.fn(),
    incrementReviewCycle: vi.fn(),
    updateSnapshot: vi.fn(),
    canResume: vi.fn(() => false),
    clear: vi.fn(),
  })),
  createInitialRunState: vi.fn(() => ({ runId: "run-1", pipeline: { stages: [], currentStageIndex: 0 }, snapshot: {} })),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface MockQueueManager {
  _tasks: TaskDefinition[];
  enqueue: Mock;
  dequeue: Mock;
  dequeueWithDeps: Mock;
  list: Mock;
  peekNext: Mock;
  remove: Mock;
  restore: Mock;
  clear: Mock;
  reorder: Mock;
  updateDependencies: Mock;
}

function createMockQueueManager(): MockQueueManager {
  const tasks: TaskDefinition[] = [];
  return {
    _tasks: tasks,
    enqueue: vi.fn((runId: string, t: Partial<TaskDefinition>) => {
      const task: TaskDefinition = {
        id: `task-${tasks.length}`, runId, type: "user_defined", priority: 1,
        timeoutMinutes: 60, promptJson: "", status: "pending", createdAt: Date.now(), ...t,
      };
      tasks.push(task);
      return task;
    }),
    dequeue: vi.fn(() => tasks.shift() ?? null),
    dequeueWithDeps: vi.fn(() => tasks.shift() ?? null),
    list: vi.fn(() => [...tasks]),
    peekNext: vi.fn(() => tasks.slice(0, 1)),
    remove: vi.fn(),
    restore: vi.fn(),
    clear: vi.fn(),
    reorder: vi.fn(),
    updateDependencies: vi.fn(),
  };
}

function createTestRun(overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id: "run-1",
    workingDir: "/tmp/test-project",
    goals: ["Build a React app with login", "Add unit tests"],
    terminationConditions: ["All goals met"],
    status: "running",
    autonomyLevel: "autonomous",
    maxConcurrentTasks: 1,
    totalTasksCompleted: 0,
    createdAt: Date.now(),
    ...overrides,
  } as ExecutionRun;
}

// ─── Unit tests: generateInitialTasks method ─────────────────────────────────

describe("Executor generateInitialTasks", () => {
  let queueManager: MockQueueManager;
  let notifications: { method: string; params: Record<string, unknown> }[];
  let notify: (method: string, params: Record<string, unknown>) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    queueManager = createMockQueueManager();
    notifications = [];
    notify = (method, params) => notifications.push({ method, params });
  });

  it("should generate initial tasks with AI-specified dependencies", async () => {
    mockExecuteTask.mockResolvedValue({
      result: '[{"content":"Setup project structure","priority":1,"reasoning":"Foundation","dependsOnIndices":[]},{"content":"Implement login","priority":2,"reasoning":"Feature","dependsOnIndices":[0]},{"content":"Implement registration","priority":2,"reasoning":"Feature","dependsOnIndices":[0]},{"content":"Restyle UI to cute theme","priority":5,"reasoning":"Polish","dependsOnIndices":[1,2]}]',
      sessionId: "s-init", totalCostUsd: 0.01, durationMs: 1000, numTurns: 3, messages: [],
    });

    const { Executor } = await import("../../src-engine/src/engine/omx-executor.js");
    const executor = new Executor(queueManager as unknown as ConstructorParameters<typeof Executor>[0], notify, "run-1");
    const run = createTestRun();

    await (executor as unknown as { generateInitialTasks: (r: ExecutionRun) => Promise<void> }).generateInitialTasks(run);

    expect(queueManager.enqueue).toHaveBeenCalledTimes(4);

    // All tasks enqueued (without dependencies in first pass)
    expect(queueManager.enqueue).toHaveBeenNthCalledWith(1, "run-1", expect.objectContaining({
      content: "Setup project structure", type: "smart_task", priority: 1,
    }));
    expect(queueManager.enqueue).toHaveBeenNthCalledWith(2, "run-1", expect.objectContaining({
      content: "Implement login", type: "smart_task", priority: 2,
    }));
    expect(queueManager.enqueue).toHaveBeenNthCalledWith(3, "run-1", expect.objectContaining({
      content: "Implement registration", type: "smart_task", priority: 2,
    }));
    expect(queueManager.enqueue).toHaveBeenNthCalledWith(4, "run-1", expect.objectContaining({
      content: "Restyle UI to cute theme", type: "smart_task", priority: 5,
    }));

    // Second pass: dependencies resolved via updateDependencies
    expect(queueManager.updateDependencies).toHaveBeenCalledTimes(3);
    // Task[1] "login" depends on task[0]
    expect(queueManager.updateDependencies).toHaveBeenCalledWith("run-1", "task-1", ["task-0"]);
    // Task[2] "registration" depends on task[0] — parallel with task[1]
    expect(queueManager.updateDependencies).toHaveBeenCalledWith("run-1", "task-2", ["task-0"]);
    // Task[3] "restyle UI" depends on task[1] AND task[2]
    expect(queueManager.updateDependencies).toHaveBeenCalledWith("run-1", "task-3", ["task-1", "task-2"]);

    expect(mockStore.saveTask).toHaveBeenCalledTimes(4);
    expect(mockStore.updateTask).toHaveBeenCalledTimes(3);
  });

  it("should create fallback tasks (one per goal) without dependencies when AI returns invalid JSON", async () => {
    mockExecuteTask.mockResolvedValue({
      result: "Sorry, I couldn't generate tasks.",
      sessionId: "s-fail", totalCostUsd: 0.01, durationMs: 500, numTurns: 1, messages: [],
    });

    const { Executor } = await import("../../src-engine/src/engine/omx-executor.js");
    const executor = new Executor(queueManager as unknown as ConstructorParameters<typeof Executor>[0], notify, "run-1");
    const run = createTestRun(); // has 2 goals

    await (executor as unknown as { generateInitialTasks: (r: ExecutionRun) => Promise<void> }).generateInitialTasks(run);

    // Fallback creates one task per goal, no dependencies (independent)
    expect(queueManager.enqueue).toHaveBeenCalledTimes(2);
    expect(queueManager.updateDependencies).not.toHaveBeenCalled();
    expect(mockStore.saveTask).toHaveBeenCalledTimes(2);
  });

  it("should create fallback tasks when AI returns non-array JSON", async () => {
    mockExecuteTask.mockResolvedValue({
      result: '{"error": "something went wrong"}',
      sessionId: "s-fail2", totalCostUsd: 0.01, durationMs: 500, numTurns: 1, messages: [],
    });

    const { Executor } = await import("../../src-engine/src/engine/omx-executor.js");
    const executor = new Executor(queueManager as unknown as ConstructorParameters<typeof Executor>[0], notify, "run-1");
    const run = createTestRun();

    await (executor as unknown as { generateInitialTasks: (r: ExecutionRun) => Promise<void> }).generateInitialTasks(run);

    expect(queueManager.enqueue).toHaveBeenCalledTimes(2);
    expect(queueManager.updateDependencies).not.toHaveBeenCalled();
  });

  it("should include dependency guidance and goals in the prompt", async () => {
    mockExecuteTask.mockResolvedValue({
      result: '[{"content":"Task","priority":5,"reasoning":"Why","dependsOnIndices":[]}]',
      sessionId: "s1", totalCostUsd: 0, durationMs: 0, numTurns: 0, messages: [],
    });

    const { Executor } = await import("../../src-engine/src/engine/omx-executor.js");
    const executor = new Executor(queueManager as unknown as ConstructorParameters<typeof Executor>[0], notify, "run-1");
    const run = createTestRun({ goals: ["Build auth system", "Write tests"] });

    await (executor as unknown as { generateInitialTasks: (r: ExecutionRun) => Promise<void> }).generateInitialTasks(run);

    const call = mockExecuteTask.mock.calls[0];
    const prompt = call[0] as string;
    expect(prompt).toContain("Build auth system");
    expect(prompt).toContain("Write tests");
    expect(prompt).toContain("5-10");
    expect(prompt).toContain("dependsOnIndices");
    expect(prompt).toContain("UI/UX restyling tasks MUST depend on feature tasks");
    expect(prompt).toContain("Independent tasks");
  });

  it("should log initial task generation", async () => {
    mockExecuteTask.mockResolvedValue({
      result: '[{"content":"Task 1","priority":5,"reasoning":"Test"}]',
      sessionId: "s1", totalCostUsd: 0, durationMs: 0, numTurns: 0, messages: [],
    });

    const { Executor } = await import("../../src-engine/src/engine/omx-executor.js");
    const executor = new Executor(queueManager as unknown as ConstructorParameters<typeof Executor>[0], notify, "run-1");
    const run = createTestRun();

    await (executor as unknown as { generateInitialTasks: (r: ExecutionRun) => Promise<void> }).generateInitialTasks(run);

    expect(mockStore.appendLog).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        source: "engine",
        level: "info",
        message: expect.stringContaining("Generating initial task plan"),
      }),
    );
    expect(mockStore.appendLog).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        message: expect.stringContaining("Initial task queued"),
      }),
    );
  });
});

// ─── Integration: start() calls generateInitialTasks based on queue state ────

describe("Executor start() — initial task generation condition", () => {
  let queueManager: MockQueueManager;

  beforeEach(() => {
    vi.clearAllMocks();
    queueManager = createMockQueueManager();
    mockStore.getLessons.mockReturnValue([]);
    mockStore.listTasks.mockReturnValue([]);
    mockStore.getCommits.mockReturnValue([]);
  });

  it("should call generateInitialTasks when queue is empty at startup", async () => {
    mockExecuteTask.mockImplementation(async (prompt: string) => {
      if (prompt.includes("initial task plan") || prompt.includes("task plan")) {
        return { result: '[{"content":"Setup project","priority":8,"reasoning":"Foundation"}]', sessionId: "s-init", totalCostUsd: 0, durationMs: 0, numTurns: 0, messages: [] };
      }
      return { result: '{"features":[]}', sessionId: "s-default", totalCostUsd: 0, durationMs: 0, numTurns: 0, messages: [] };
    });

    const { Executor } = await import("../../src-engine/src/engine/omx-executor.js");
    const executor = new Executor(queueManager as unknown as ConstructorParameters<typeof Executor>[0], () => {}, "run-1");
    const run = createTestRun({ featuresGeneratedAt: Date.now() });

    const spy = vi.spyOn(executor as unknown as { generateInitialTasks: (r: ExecutionRun) => Promise<void> }, "generateInitialTasks");

    // Stop executor early to avoid pipeline execution
    const startPromise = executor.start(run);
    await new Promise(r => setTimeout(r, 100));
    executor.stop();
    await startPromise.catch(() => {});

    expect(spy).toHaveBeenCalled();
  });

  it("should NOT call generateInitialTasks when queue has pre-existing tasks", async () => {
    queueManager.enqueue("run-1", { content: "Existing task", type: "user_defined", priority: 1 });

    const { Executor } = await import("../../src-engine/src/engine/omx-executor.js");
    const executor = new Executor(queueManager as unknown as ConstructorParameters<typeof Executor>[0], () => {}, "run-1");

    const spy = vi.spyOn(executor as unknown as { generateInitialTasks: (r: ExecutionRun) => Promise<void> }, "generateInitialTasks");

    const run = createTestRun({ featuresGeneratedAt: Date.now() });
    const startPromise = executor.start(run);

    await new Promise(r => setTimeout(r, 300));
    executor.stop();
    await startPromise.catch(() => {});

    expect(spy).not.toHaveBeenCalled();
  });
});

// ─── RPC Methods integration: run.create without tasks ───────────────────────

describe("run.create without initial tasks (RPC integration)", () => {
  let methodHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ai-workbench-initial-tasks-rpc-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    vi.resetModules();

    vi.doMock("../../src-engine/src/db/store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/db/store.js")>();
      return { Store: vi.fn(function (this: unknown) { return new actual.Store(testDir); }) };
    });
    vi.doMock("../../src-engine/src/db/share-store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/db/share-store.js")>();
      return { ShareStore: vi.fn(function (this: unknown) { return new actual.ShareStore(testDir); }) };
    });
    vi.doMock("../../src-engine/src/db/subscription-store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/db/subscription-store.js")>();
      return { SubscriptionStore: vi.fn(function (this: unknown) { return new actual.SubscriptionStore(testDir); }) };
    });
    vi.doMock("../../src-engine/src/db/template-store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/db/template-store.js")>();
      return { TemplateStore: vi.fn(function (this: unknown) { return new actual.TemplateStore(testDir); }) };
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
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should create run without tasks parameter", async () => {
    const run = await methodHandlers["run.create"]({
      workingDir: "/tmp/test",
      goals: ["Build a React app"],
      terminationConditions: ["All goals met"],
    }) as ExecutionRun;

    expect(run.id).toBeDefined();
    expect(run.status).toBe("idle");

    const tasks = await methodHandlers["run.tasks"]({ runId: run.id }) as TaskDefinition[];
    expect(tasks).toHaveLength(0);
  });

  it("should start run created without tasks", async () => {
    const run = await methodHandlers["run.create"]({
      workingDir: "/tmp/test",
      goals: ["Build a React app"],
      terminationConditions: ["All goals met"],
    }) as ExecutionRun;

    const result = await methodHandlers["task.start"]({ runId: run.id }) as Record<string, unknown>;
    expect(result.status).toBe("running");

    await methodHandlers["run.stop"]({ runId: run.id });
  });

  it("should still support creating run with tasks for backward compatibility", async () => {
    const run = await methodHandlers["run.create"]({
      workingDir: "/tmp/test",
      goals: ["Build a React app"],
      terminationConditions: ["All goals met"],
      tasks: [{ content: "Setup project", type: "user_defined", priority: 1 }],
    }) as ExecutionRun;

    expect(run.id).toBeDefined();

    const tasks = await methodHandlers["run.tasks"]({ runId: run.id }) as TaskDefinition[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].content).toBe("Setup project");
  });
});
