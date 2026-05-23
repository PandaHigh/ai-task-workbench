import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, createMockRun, createMockTask } from "../../test/test-utils";
import { EvolutionDashboard } from "./EvolutionDashboard";
import { useEvolutionStore } from "../../stores/evolution-store";
import { useTaskStore } from "../../stores/task-store";
import type { TaskDefinition, GitCommit, LessonLearned } from "@ai-workbench/shared";
import { Routes, Route } from "react-router-dom";

// ---------- mocks ----------

const { mockCall } = vi.hoisted(() => ({
  mockCall: vi.fn(),
}));

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ connected: true, call: mockCall }),
}));

vi.mock("../../lib/engine-client", () => ({
  engineClient: {
    call: mockCall,
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    onNotification: vi.fn().mockReturnValue(() => {}),
  },
}));

vi.mock("../dashboard/RobotMascot", () => ({
  RobotMascot: ({ mood }: { mood: string }) => (
    <div data-testid="robot-mascot" data-mood={mood} />
  ),
}));

// jsdom doesn't implement scrollIntoView
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// ---------- helpers ----------

function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return createMockTask(overrides);
}

function makeCommit(overrides: Partial<GitCommit> = {}): GitCommit {
  return {
    id: 1,
    taskId: "task-abc",
    runId: "run-123456",
    hash: "abc1234567",
    message: "fix: TypeScript errors",
    isAiCommit: true,
    timestamp: Date.now(),
    additions: 10,
    deletions: 2,
    ...overrides,
  };
}

function makeLesson(overrides: Partial<LessonLearned> = {}): LessonLearned {
  return {
    id: 1,
    runId: "run-123456",
    category: "failure",
    lesson: "Always check return types",
    score: 0.45,
    createdAt: Date.now(),
    ...overrides,
  };
}

const defaultRun = createMockRun({
  id: "run-123456",
  status: "idle",
  startedAt: Date.now() - 60000,
  totalCostUsd: 12.5,
  totalTasksCompleted: 3,
  goals: ["Fix bugs", "Add tests"],
  terminationConditions: ["All tests pass"],
  workingDir: "/home/user/my-project",
});

function setupMocks(overrides: { queue?: TaskDefinition[]; commits?: GitCommit[]; lessons?: LessonLearned[] } = {}) {
  mockCall.mockImplementation((method: string) => {
    if (method === "queue.list") return Promise.resolve({ queue: overrides.queue ?? [] });
    if (method === "run.commits") return Promise.resolve(overrides.commits ?? []);
    if (method === "run.lessons") return Promise.resolve(overrides.lessons ?? []);
    return Promise.resolve({});
  });
}

function renderDashboard(runOverrides: Record<string, unknown> = {}) {
  const run = { ...defaultRun, ...runOverrides };
  useTaskStore.setState({ tasks: [run] });

  return renderWithProviders(
    <Routes>
      <Route path="/evolution/:runId" element={<EvolutionDashboard />} />
    </Routes>,
    { initialEntries: [`/evolution/${run.id}`] },
  );
}

// ---------- tests ----------

describe("EvolutionDashboard", () => {
  beforeEach(() => {
    useEvolutionStore.getState().reset();
    vi.clearAllMocks();
    setupMocks();
  });

  // ===== Header =====

  it("renders header with run id and status", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("自进化看板")).toBeInTheDocument();
    });
    expect(screen.getByText("run-1234")).toBeInTheDocument();
    expect(screen.getByText("my-project")).toBeInTheDocument();
  });

  it("shows correct status badge when idle", async () => {
    renderDashboard({ status: "idle" });

    await waitFor(() => {
      const badge = screen.getByText("空闲");
      expect(badge).toBeInTheDocument();
    });
  });

  it("shows '运行中' when running", async () => {
    renderDashboard();

    act(() => {
      useEvolutionStore.getState().setRunning(true);
    });

    await waitFor(() => {
      expect(screen.getByText("运行中")).toBeInTheDocument();
    });
  });

  it("shows '已完成' when completed", async () => {
    renderDashboard({ status: "completed" });

    await waitFor(() => {
      const badges = screen.getAllByText("已完成");
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows '失败' when failed", async () => {
    renderDashboard({ status: "failed" });

    await waitFor(() => {
      expect(screen.getByText("失败")).toBeInTheDocument();
    });
  });

  it("navigates back on click 返回", async () => {
    const user = userEvent.setup();
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByLabelText("返回")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("返回"));
  });

  // ===== Loading state =====

  it("shows skeleton loading state", async () => {
    mockCall.mockReturnValue(new Promise(() => {}));
    const run = { ...defaultRun };
    useTaskStore.setState({ tasks: [run] });

    renderWithProviders(
      <Routes>
        <Route path="/evolution/:runId" element={<EvolutionDashboard />} />
      </Routes>,
      { initialEntries: [`/evolution/${run.id}`] },
    );

    await waitFor(() => {
      const skeletons = screen.getAllByRole("progressbar");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  // ===== Task Queue =====

  it("shows empty queue with start button when idle", async () => {
    renderDashboard({ status: "idle" });

    await waitFor(() => {
      expect(screen.getByText("队列为空")).toBeInTheDocument();
    });
    expect(screen.getByText("开始执行")).toBeInTheDocument();
  });

  it("shows queue items with correct content", async () => {
    const tasks = [
      makeTask({ id: "t1", content: "Task Alpha", type: "user_defined", priority: 1 }),
      makeTask({ id: "t2", content: "Task Beta", type: "smart_task", priority: 2 }),
    ];

    setupMocks({ queue: tasks });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Task Alpha")).toBeInTheDocument();
    });
    expect(screen.getByText("Task Beta")).toBeInTheDocument();
    expect(screen.getByText(/任务队列 \(2\)/)).toBeInTheDocument();
  });

  it("renders task type and priority labels", async () => {
    setupMocks({ queue: [makeTask({ id: "t1", content: "A task", type: "user_defined", priority: 3 })] });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("用户")).toBeInTheDocument();
    });
    expect(screen.getByText("P3")).toBeInTheDocument();
  });

  it("sets active task on queue item click", async () => {
    const user = userEvent.setup();
    setupMocks({ queue: [makeTask({ id: "t1", content: "Click task" })] });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Click task")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Click task"));
    expect(useEvolutionStore.getState().activeTaskId).toBe("t1");
  });

  it("highlights active task in queue", async () => {
    setupMocks({ queue: [makeTask({ id: "t1", content: "Active task" })] });
    renderDashboard();

    act(() => {
      useEvolutionStore.getState().setActiveTask("t1");
    });

    await waitFor(() => {
      const item = screen.getByRole("option", { name: /Active task/ });
      expect(item.style.border).toContain("var(--blue)");
    });
  });

  // ===== Drag and drop reorder =====

  it("handles drag start and drop to reorder tasks", async () => {
    const tasks = [
      makeTask({ id: "t1", content: "First" }),
      makeTask({ id: "t2", content: "Second" }),
    ];

    mockCall.mockImplementation((method: string) => {
      if (method === "queue.list") return Promise.resolve({ queue: tasks });
      if (method === "run.commits") return Promise.resolve([]);
      if (method === "run.lessons") return Promise.resolve([]);
      if (method === "queue.reorder") return Promise.resolve({});
      return Promise.resolve({});
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("First")).toBeInTheDocument();
    });

    const firstItem = screen.getByRole("option", { name: /First/ });
    const secondItem = screen.getByRole("option", { name: /Second/ });

    fireEvent.dragStart(firstItem);
    fireEvent.dragOver(secondItem);
    fireEvent.drop(secondItem);

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("queue.reorder", expect.objectContaining({
        taskIds: ["t2", "t1"],
      }));
    });
  });

  it("does not reorder when dropping on same item", async () => {
    const tasks = [makeTask({ id: "t1", content: "Only" })];
    setupMocks({ queue: tasks });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Only")).toBeInTheDocument();
    });

    const item = screen.getByRole("option", { name: /Only/ });
    fireEvent.dragStart(item);
    fireEvent.dragOver(item);
    fireEvent.drop(item);

    expect(mockCall).not.toHaveBeenCalledWith("queue.reorder", expect.anything());
  });

  // ===== Keyboard reorder =====

  it("reorders with Ctrl+ArrowUp via listbox", async () => {
    const user = userEvent.setup();
    const tasks = [
      makeTask({ id: "t1", content: "First" }),
      makeTask({ id: "t2", content: "Second" }),
    ];

    mockCall.mockImplementation((method: string) => {
      if (method === "queue.list") return Promise.resolve({ queue: tasks });
      if (method === "run.commits") return Promise.resolve([]);
      if (method === "run.lessons") return Promise.resolve([]);
      if (method === "queue.reorder") return Promise.resolve({});
      return Promise.resolve({});
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Second")).toBeInTheDocument();
    });

    // Focus second item to set focusIdx=1
    const secondItem = screen.getByRole("option", { name: /Second/ });
    await user.click(secondItem);

    // Press Ctrl+ArrowUp on the listbox
    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "ArrowUp", ctrlKey: true });

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("queue.reorder", expect.objectContaining({
        taskIds: ["t2", "t1"],
      }));
    });
  });

  it("reorders with Ctrl+ArrowDown via listbox", async () => {
    const user = userEvent.setup();
    const tasks = [
      makeTask({ id: "t1", content: "First" }),
      makeTask({ id: "t2", content: "Second" }),
    ];

    mockCall.mockImplementation((method: string) => {
      if (method === "queue.list") return Promise.resolve({ queue: tasks });
      if (method === "run.commits") return Promise.resolve([]);
      if (method === "run.lessons") return Promise.resolve([]);
      if (method === "queue.reorder") return Promise.resolve({});
      return Promise.resolve({});
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("First")).toBeInTheDocument();
    });

    const firstItem = screen.getByRole("option", { name: /First/ });
    await user.click(firstItem);

    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: "ArrowDown", ctrlKey: true });

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("queue.reorder", expect.objectContaining({
        taskIds: ["t2", "t1"],
      }));
    });
  });

  // ===== Tab panels =====

  describe("Tab panels", () => {
    it("shows logs tab by default", async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText(/日志 \(0\)/)).toBeInTheDocument();
      });
    });

    it("switches to commits tab", async () => {
      const user = userEvent.setup();
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText(/Git 提交 \(0\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Git 提交 \(0\)/));

      expect(screen.getByText("暂无 Git 提交记录")).toBeInTheDocument();
    });

    it("switches to lessons tab", async () => {
      const user = userEvent.setup();
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText(/经验教训 \(0\)/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/经验教训 \(0\)/));

      expect(screen.getByText("暂无经验教训")).toBeInTheDocument();
    });

    it("refreshes data when switching to commits tab", async () => {
      const user = userEvent.setup();
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText(/Git 提交/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/Git 提交/));

      expect(mockCall).toHaveBeenCalledWith("run.commits", { runId: "run-123456" });
    });

    it("refreshes data when switching to lessons tab", async () => {
      const user = userEvent.setup();
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText(/经验教训/)).toBeInTheDocument();
      });

      await user.click(screen.getByText(/经验教训/));

      expect(mockCall).toHaveBeenCalledWith("run.lessons", { runId: "run-123456" });
    });
  });

  // ===== Logs display =====

  describe("Logs tab", () => {
    it("displays log entries", async () => {
      renderDashboard();

      act(() => {
        useEvolutionStore.getState().addLog({
          id: 1, timestamp: Date.now(), level: "info", source: "engine", message: "Task started",
        });
        useEvolutionStore.getState().addLog({
          id: 2, timestamp: Date.now(), level: "error", source: "engine", message: "Something failed",
        });
      });

      await waitFor(() => {
        expect(screen.getByText("Task started")).toBeInTheDocument();
      });
      expect(screen.getByText("Something failed")).toBeInTheDocument();
    });

    it("shows empty state when no logs", async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText("等待任务执行")).toBeInTheDocument();
      });
    });

    it("displays log levels", async () => {
      renderDashboard();

      act(() => {
        useEvolutionStore.getState().addLog({ id: 1, timestamp: Date.now(), level: "error", source: "engine", message: "err" });
        useEvolutionStore.getState().addLog({ id: 2, timestamp: Date.now(), level: "warn", source: "engine", message: "warn" });
        useEvolutionStore.getState().addLog({ id: 3, timestamp: Date.now(), level: "info", source: "engine", message: "info" });
      });

      await waitFor(() => {
        expect(screen.getByText("[ERROR]")).toBeInTheDocument();
      });
      expect(screen.getByText("[WARN]")).toBeInTheDocument();
      expect(screen.getByText("[INFO]")).toBeInTheDocument();
    });
  });

  // ===== Commits display =====

  describe("Commits tab", () => {
    it("displays commit entries with hash and message", async () => {
      const commit = makeCommit({ hash: "deadbeef", message: "fix: all bugs" });
      setupMocks({ commits: [commit] });
      renderDashboard();

      const user = userEvent.setup();
      await waitFor(() => {
        expect(screen.getByText(/Git 提交 \(1\)/)).toBeInTheDocument();
      });
      await user.click(screen.getByText(/Git 提交 \(1\)/));

      await waitFor(() => {
        expect(screen.getByText("deadbee")).toBeInTheDocument();
        expect(screen.getByText("fix: all bugs")).toBeInTheDocument();
      });
    });

    it("shows AI commit badge", async () => {
      setupMocks({ commits: [makeCommit({ isAiCommit: true })] });
      renderDashboard();

      const user = userEvent.setup();
      await waitFor(() => {
        expect(screen.getByText(/Git 提交 \(1\)/)).toBeInTheDocument();
      });
      await user.click(screen.getByText(/Git 提交 \(1\)/));

      await waitFor(() => {
        expect(screen.getByText("#AI")).toBeInTheDocument();
      });
    });

    it("shows taskId for commits", async () => {
      setupMocks({ commits: [makeCommit({ taskId: "task-abc123def" })] });
      renderDashboard();

      const user = userEvent.setup();
      await waitFor(() => {
        expect(screen.getByText(/Git 提交 \(1\)/)).toBeInTheDocument();
      });
      await user.click(screen.getByText(/Git 提交 \(1\)/));

      await waitFor(() => {
        expect(screen.getByText(/Task: task-abc/)).toBeInTheDocument();
      });
    });
  });

  // ===== Lessons display =====

  describe("Lessons tab", () => {
    it("displays lesson entries with category and score", async () => {
      setupMocks({ lessons: [makeLesson({ category: "failure", lesson: "Check types", score: 0.45 })] });
      renderDashboard();

      const user = userEvent.setup();
      await waitFor(() => {
        expect(screen.getByText(/经验教训 \(1\)/)).toBeInTheDocument();
      });
      await user.click(screen.getByText(/经验教训 \(1\)/));

      await waitFor(() => {
        expect(screen.getByText("failure")).toBeInTheDocument();
        expect(screen.getByText("Check types")).toBeInTheDocument();
        expect(screen.getByText("Score: 45%")).toBeInTheDocument();
      });
    });

    it("displays success category lessons", async () => {
      setupMocks({ lessons: [makeLesson({ category: "success", lesson: "Good pattern", score: 0.9 })] });
      renderDashboard();

      const user = userEvent.setup();
      await waitFor(() => {
        expect(screen.getByText(/经验教训 \(1\)/)).toBeInTheDocument();
      });
      await user.click(screen.getByText(/经验教训 \(1\)/));

      await waitFor(() => {
        expect(screen.getByText("success")).toBeInTheDocument();
      });
    });

    it("displays lesson without score", async () => {
      const { score: _, ...lesson } = makeLesson({ score: undefined });
      setupMocks({ lessons: [lesson as LessonLearned] });
      renderDashboard();

      const user = userEvent.setup();
      await waitFor(() => {
        expect(screen.getByText(/经验教训 \(1\)/)).toBeInTheDocument();
      });
      await user.click(screen.getByText(/经验教训 \(1\)/));

      await waitFor(() => {
        expect(screen.getByText("Always check return types")).toBeInTheDocument();
      });
      expect(screen.queryByText(/Score:/)).not.toBeInTheDocument();
    });
  });

  // ===== Control panel (right sidebar) =====

  describe("Control panel", () => {
    it("shows start button when idle", async () => {
      renderDashboard({ status: "idle" });

      await waitFor(() => {
        expect(screen.getByText("▶ 开始")).toBeInTheDocument();
      });
    });

    it("shows pause button when running", async () => {
      renderDashboard();

      act(() => {
        useEvolutionStore.getState().setRunning(true);
      });

      await waitFor(() => {
        expect(screen.getByText("⏸ 暂停")).toBeInTheDocument();
      });
    });

    it("disables start button when completed", async () => {
      renderDashboard({ status: "completed" });

      await waitFor(() => {
        const btn = screen.getByText("▶ 开始");
        expect(btn).toBeDisabled();
      });
    });

    it("handles start action", async () => {
      const user = userEvent.setup();
      mockCall.mockImplementation((method: string) => {
        if (method === "task.start") return Promise.resolve({});
        if (method === "queue.list") return Promise.resolve({ queue: [] });
        if (method === "run.commits") return Promise.resolve([]);
        if (method === "run.lessons") return Promise.resolve([]);
        return Promise.resolve({});
      });

      renderDashboard({ status: "idle" });

      await waitFor(() => {
        expect(screen.getByText("▶ 开始")).toBeInTheDocument();
      });

      await user.click(screen.getByText("▶ 开始"));

      await waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("task.start", { runId: "run-123456" });
      });
      expect(useEvolutionStore.getState().isRunning).toBe(true);
    });

    it("handles start failure gracefully", async () => {
      const user = userEvent.setup();
      mockCall.mockImplementation((method: string) => {
        if (method === "task.start") return Promise.reject(new Error("Engine busy"));
        if (method === "queue.list") return Promise.resolve({ queue: [] });
        if (method === "run.commits") return Promise.resolve([]);
        if (method === "run.lessons") return Promise.resolve([]);
        return Promise.resolve({});
      });

      renderDashboard({ status: "idle" });

      await waitFor(() => {
        expect(screen.getByText("▶ 开始")).toBeInTheDocument();
      });

      await user.click(screen.getByText("▶ 开始"));

      await waitFor(() => {
        expect(useEvolutionStore.getState().logs.length).toBeGreaterThanOrEqual(1);
        expect(useEvolutionStore.getState().logs[0].level).toBe("error");
      });
    });

    it("handles pause action", async () => {
      const user = userEvent.setup();
      mockCall.mockImplementation((method: string) => {
        if (method === "run.stop") return Promise.resolve({});
        if (method === "queue.list") return Promise.resolve({ queue: [] });
        if (method === "run.commits") return Promise.resolve([]);
        if (method === "run.lessons") return Promise.resolve([]);
        return Promise.resolve({});
      });

      renderDashboard();

      act(() => {
        useEvolutionStore.getState().setRunning(true);
      });

      await waitFor(() => {
        expect(screen.getByText("⏸ 暂停")).toBeInTheDocument();
      });

      await user.click(screen.getByText("⏸ 暂停"));

      await waitFor(() => {
        expect(mockCall).toHaveBeenCalledWith("run.stop", { runId: "run-123456" });
      });
      expect(useEvolutionStore.getState().isRunning).toBe(false);
    });

    it("handles pause failure gracefully", async () => {
      const user = userEvent.setup();
      mockCall.mockImplementation((method: string) => {
        if (method === "run.stop") return Promise.reject(new Error("Stop failed"));
        if (method === "queue.list") return Promise.resolve({ queue: [] });
        if (method === "run.commits") return Promise.resolve([]);
        if (method === "run.lessons") return Promise.resolve([]);
        return Promise.resolve({});
      });

      renderDashboard();

      act(() => {
        useEvolutionStore.getState().setRunning(true);
      });

      await waitFor(() => {
        expect(screen.getByText("⏸ 暂停")).toBeInTheDocument();
      });

      // Should not crash
      await user.click(screen.getByText("⏸ 暂停"));
    });
  });

  // ===== Budget progress =====

  describe("Budget progress", () => {
    it("shows budget progress bar", async () => {
      renderDashboard({ totalCostUsd: 12.5 });

      await waitFor(() => {
        expect(screen.getByText(/\$12\.50 \/ \$50/)).toBeInTheDocument();
      });
      const progressBar = screen.getByText(/\$12\.50 \/ \$50/).parentElement!
        .nextElementSibling!.firstChild as HTMLElement;
      expect(progressBar.style.width).toBe("25%");
    });

    it("does not show budget when totalCostUsd is 0", async () => {
      renderDashboard({ totalCostUsd: 0 });

      await waitFor(() => {
        expect(screen.getByText("自进化看板")).toBeInTheDocument();
      });
      expect(screen.queryByText(/预算消耗/)).not.toBeInTheDocument();
    });

    it("shows red color when budget > 80%", async () => {
      renderDashboard({ totalCostUsd: 45 });

      await waitFor(() => {
        expect(screen.getByText(/\$45\.00 \/ \$50/)).toBeInTheDocument();
      });
      const budgetText = screen.getByText(/\$45\.00 \/ \$50/);
      expect(budgetText.style.color).toContain("var(--red)");
    });

    it("caps budget at 100%", async () => {
      renderDashboard({ totalCostUsd: 100 });

      await waitFor(() => {
        expect(screen.getByText(/\$100\.00 \/ \$50/)).toBeInTheDocument();
      });
      const progressBar = screen.getByText(/\$100\.00 \/ \$50/).parentElement!
        .nextElementSibling!.firstChild as HTMLElement;
      expect(progressBar.style.width).toBe("100%");
    });
  });

  // ===== Run stats sidebar =====

  describe("Run stats", () => {
    it("displays run statistics", async () => {
      renderDashboard({ totalCostUsd: 5.25, totalTasksCompleted: 7 });

      await waitFor(() => {
        expect(screen.getByText("运行统计")).toBeInTheDocument();
      });
      expect(screen.getByText("7")).toBeInTheDocument();
      expect(screen.getByText("$5.2500")).toBeInTheDocument();
    });

    it("displays goals", async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText("目标")).toBeInTheDocument();
      });
      expect(screen.getByText("Fix bugs")).toBeInTheDocument();
      expect(screen.getByText("Add tests")).toBeInTheDocument();
    });

    it("displays termination conditions", async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText("终止条件")).toBeInTheDocument();
      });
      expect(screen.getByText("All tests pass")).toBeInTheDocument();
    });

    it("displays final report when present", async () => {
      renderDashboard({ finalReport: "All goals achieved successfully." });

      await waitFor(() => {
        expect(screen.getByText("最终报告")).toBeInTheDocument();
      });
      expect(screen.getByText("All goals achieved successfully.")).toBeInTheDocument();
    });
  });

  // ===== Timeout control =====

  describe("Timeout control", () => {
    it("displays timeout slider", async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByLabelText("任务超时时间")).toBeInTheDocument();
      });
      expect(screen.getByText(/超时: 60min/)).toBeInTheDocument();
    });

    it("shows apply button when active task selected", async () => {
      renderDashboard();

      act(() => {
        useEvolutionStore.getState().setActiveTask("some-task");
      });

      await waitFor(() => {
        expect(screen.getByText("应用")).toBeInTheDocument();
      });
    });
  });

  // ===== Agent mode =====

  describe("Agent mode", () => {
    it("shows agent mode buttons", async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText("单 Agent")).toBeInTheDocument();
        expect(screen.getByText("多 Agent")).toBeInTheDocument();
      });
    });

    it("switches to multi agent mode", async () => {
      const user = userEvent.setup();
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText("多 Agent")).toBeInTheDocument();
      });

      await user.click(screen.getByText("多 Agent"));
    });
  });

  // ===== Data loading errors =====

  describe("Data loading errors", () => {
    it("renders when queue loading fails", async () => {
      mockCall.mockImplementation((method: string) => {
        if (method === "queue.list") return Promise.reject(new Error("Network error"));
        if (method === "run.commits") return Promise.resolve([]);
        if (method === "run.lessons") return Promise.resolve([]);
        return Promise.resolve({});
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText("自进化看板")).toBeInTheDocument();
      });
    });

    it("renders when commits loading fails", async () => {
      mockCall.mockImplementation((method: string) => {
        if (method === "queue.list") return Promise.resolve({ queue: [] });
        if (method === "run.commits") return Promise.reject(new Error("Network error"));
        if (method === "run.lessons") return Promise.resolve([]);
        return Promise.resolve({});
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText("自进化看板")).toBeInTheDocument();
      });
    });

    it("renders when lessons loading fails", async () => {
      mockCall.mockImplementation((method: string) => {
        if (method === "queue.list") return Promise.resolve({ queue: [] });
        if (method === "run.commits") return Promise.resolve([]);
        if (method === "run.lessons") return Promise.reject(new Error("Network error"));
        return Promise.resolve({});
      });

      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText("自进化看板")).toBeInTheDocument();
      });
    });
  });

  // ===== WebSocket data push simulation =====

  describe("WebSocket data updates", () => {
    it("updates display when store queue changes", async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText("队列为空")).toBeInTheDocument();
      });

      act(() => {
        useEvolutionStore.getState().setQueue([
          makeTask({ id: "new-task", content: "Newly arrived task" }),
        ]);
      });

      await waitFor(() => {
        expect(screen.getByText("Newly arrived task")).toBeInTheDocument();
      });
    });

    it("updates log count in tab when new logs added", async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText(/日志 \(0\)/)).toBeInTheDocument();
      });

      act(() => {
        useEvolutionStore.getState().addLog({
          id: 1, timestamp: Date.now(), level: "info", source: "engine", message: "New log",
        });
      });

      await waitFor(() => {
        expect(screen.getByText(/日志 \(1\)/)).toBeInTheDocument();
      });
    });

    it("updates commit count in tab", async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText(/Git 提交 \(0\)/)).toBeInTheDocument();
      });

      act(() => {
        useEvolutionStore.getState().setCommits([makeCommit()]);
      });

      await waitFor(() => {
        expect(screen.getByText(/Git 提交 \(1\)/)).toBeInTheDocument();
      });
    });

    it("updates lesson count in tab", async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByText(/经验教训 \(0\)/)).toBeInTheDocument();
      });

      act(() => {
        useEvolutionStore.getState().setLessons([makeLesson()]);
      });

      await waitFor(() => {
        expect(screen.getByText(/经验教训 \(1\)/)).toBeInTheDocument();
      });
    });
  });

  // ===== Accessibility =====

  describe("Accessibility", () => {
    it("has correct listbox role for task queue", async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByRole("listbox", { name: /任务队列/ })).toBeInTheDocument();
      });
    });

    it("has aria-grabbed on draggable items", async () => {
      setupMocks({ queue: [makeTask({ id: "t1", content: "Drag me" })] });
      renderDashboard();

      await waitFor(() => {
        const option = screen.getByRole("option", { name: /Drag me/ });
        expect(option).toHaveAttribute("aria-grabbed", "false");
      });
    });

    it("has aria-label on back button", async () => {
      renderDashboard();

      await waitFor(() => {
        expect(screen.getByLabelText("返回")).toBeInTheDocument();
      });
    });
  });
});
