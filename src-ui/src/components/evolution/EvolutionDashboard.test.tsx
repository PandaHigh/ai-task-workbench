import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EvolutionDashboard } from "./EvolutionDashboard";

const mockCall = vi.fn();

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ connected: true, call: mockCall }),
}));

vi.mock("../../stores/task-store", () => ({
  useTaskStore: vi.fn(),
}));

vi.mock("../../stores/evolution-store", () => ({
  useEvolutionStore: vi.fn(),
}));

vi.mock("../../hooks/useKeyboard", () => ({
  setModalActive: vi.fn(),
  useRegisterShortcut: vi.fn(),
}));

import { useTaskStore } from "../../stores/task-store";
import { useEvolutionStore } from "../../stores/evolution-store";
import type { ExecutionRun, TaskDefinition, GitCommit, LessonLearned } from "@ai-workbench/shared";

function makeRun(overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id: "run-001",
    workingDir: "/home/user/project",
    goals: ["目标1", "目标2"],
    terminationConditions: ["终止条件1"],
    status: "idle",
    totalCostUsd: 1.5,
    totalTasksCompleted: 5,
    startedAt: Date.now() - 600_000,
    ...overrides,
  };
}

function makeTaskDef(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: "task-001",
    runId: "run-001",
    type: "user_defined",
    priority: 1,
    content: "用户任务内容",
    timeoutMinutes: 60,
    promptJson: "{}",
    status: "pending",
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeCommit(overrides: Partial<GitCommit> = {}): GitCommit {
  return {
    id: 1,
    taskId: "task-001",
    runId: "run-001",
    hash: "abcdef1234567890",
    message: "feat: 添加新功能",
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
    runId: "run-001",
    category: "failure",
    lesson: "教训内容",
    createdAt: Date.now(),
    ...overrides,
  };
}

const defaultEvolutionStore = {
  queue: [] as TaskDefinition[],
  activeTaskIds: [] as string[],
  logs: [] as Array<{ id: number; timestamp: number; level: string; source: string; message: string }>,
  commits: [] as GitCommit[],
  lessons: [] as LessonLearned[],
  isRunning: false,
  setQueue: vi.fn(),
  addActiveTask: vi.fn(),
  removeActiveTask: vi.fn(),
  addLog: vi.fn(),
  setCommits: vi.fn(),
  setLessons: vi.fn(),
  setRunning: vi.fn(),
  reset: vi.fn(),
};

function renderEvolution(runId = "run-001", run?: ExecutionRun) {
  const tasks = run ? [run] : [makeRun()];
  const taskStoreState = {
    tasks,
    activeRunId: runId,
    loading: false,
    loadTasks: vi.fn(),
    addTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    setActiveRun: vi.fn(),
  };
  vi.mocked(useTaskStore).mockImplementation(((selector?: Function) =>
    selector ? selector(taskStoreState) : taskStoreState) as any);

  return render(
    <MemoryRouter initialEntries={[`/evolution/${runId}`]}>
      <Routes>
        <Route path="/evolution/:runId" element={<EvolutionDashboard />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function setupEvolutionStore(overrides: Partial<typeof defaultEvolutionStore> = {}) {
  vi.mocked(useEvolutionStore).mockImplementation(((selector?: Function) =>
    selector ? selector({ ...defaultEvolutionStore, ...overrides }) : { ...defaultEvolutionStore, ...overrides }) as any);
}

describe("EvolutionDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupEvolutionStore();
    mockCall.mockImplementation(async (method: string) => {
      if (method === "queue.list") return { queue: [] };
      if (method === "run.commits") return [];
      if (method === "run.lessons") return [];
      if (method === "run.tasks") return [];
      return null;
    });
  });

  it("渲染自进化看板标题", async () => {
    renderEvolution();
    expect(screen.getByText("任务详情")).toBeInTheDocument();
  });

  it("加载时调用 queue.list、run.commits、run.lessons", async () => {
    renderEvolution();
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("queue.list", { runId: "run-001" });
      expect(mockCall).toHaveBeenCalledWith("run.commits", { runId: "run-001" });
      expect(mockCall).toHaveBeenCalledWith("run.lessons", { runId: "run-001" });
    });
  });

  it("渲染任务队列空状态", async () => {
    renderEvolution();
    await waitFor(() => {
      expect(screen.getByText(/没有待办任务/)).toBeInTheDocument();
    });
  });

  it("渲染任务队列项", async () => {
    const queue = [makeTaskDef(), makeTaskDef({ id: "task-002", content: "第二个任务", priority: 2 })];
    setupEvolutionStore({ queue });
    renderEvolution();
    await waitFor(() => {
      expect(screen.getByText("用户任务内容")).toBeInTheDocument();
      expect(screen.getByText("第二个任务")).toBeInTheDocument();
    });
  });

  it("显示日志、提交、教训标签", async () => {
    const user = userEvent.setup();
    renderEvolution();
    // Default is simple mode — click "详细" to show all tabs
    await user.click(screen.getByText("详细"));
    expect(screen.getAllByText(/^记录/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/^保存/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/^经验/).length).toBeGreaterThanOrEqual(1);
  });

  it("切换到提交标签显示提交内容", async () => {
    const user = userEvent.setup();
    const commits = [makeCommit()];
    setupEvolutionStore({ commits });
    renderEvolution();
    // Ensure detailed mode to show the commits tab
    const modeBtn = screen.queryByText("详细");
    if (modeBtn) await user.click(modeBtn);
    const saveTabs = screen.getAllByText(/^保存/);
    await user.click(saveTabs[0]);
    expect(screen.getByText("feat: 添加新功能")).toBeInTheDocument();
    expect(screen.getByText("#AI")).toBeInTheDocument();
  });

  it("切换到教训标签显示教训内容", async () => {
    const user = userEvent.setup();
    const lessons = [makeLesson()];
    setupEvolutionStore({ lessons });
    renderEvolution();
    // Ensure detailed mode to show the lessons tab
    const modeBtn = screen.queryByText("详细");
    if (modeBtn) await user.click(modeBtn);
    const lessonTabs = screen.getAllByText(/^经验/);
    await user.click(lessonTabs[0]);
    expect(screen.getByText("教训内容")).toBeInTheDocument();
    expect(screen.getByText("failure")).toBeInTheDocument();
  });

  it("点击开始执行调用 task.start", async () => {
    const user = userEvent.setup();
    setupEvolutionStore();
    renderEvolution();
    const startBtn = screen.getByText("▶ 开始");
    await user.click(startBtn);
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("task.start", { runId: "run-001" });
    });
  });

  it("运行中显示停止按钮", async () => {
    setupEvolutionStore({ isRunning: true });
    renderEvolution();
    expect(screen.getByText("⏹ 停止")).toBeInTheDocument();
  });

  it("点击返回导航到首页", async () => {
    const user = userEvent.setup();
    renderEvolution();
    const backBtn = screen.getByLabelText("返回");
    await user.click(backBtn);
    expect(screen.getByText("Home")).toBeInTheDocument();
  });

  it("添加新任务到队列", async () => {
    const user = userEvent.setup();
    const setQueue = vi.fn();
    setupEvolutionStore({ queue: [], setQueue });
    mockCall.mockImplementation(async (method: string) => {
      if (method === "queue.list") return { queue: [makeTaskDef()] };
      if (method === "task.create") return {};
      if (method === "run.commits") return [];
      if (method === "run.lessons") return [];
      if (method === "run.tasks") return [];
      return null;
    });
    renderEvolution();
    // Click the add task button to open modal
    await user.click(screen.getByText("+ 添加"));
    // Find the textarea by placeholder and type into it
    const textarea = screen.getByPlaceholderText("描述你的任务...");
    await user.type(textarea, "新测试任务");
    // Click the confirm button
    await user.click(screen.getByText("确认添加"));
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("task.create", expect.objectContaining({ content: "新测试任务" }));
    });
  });

  it("显示预算消耗进度条", () => {
    const run = makeRun({ totalCostUsd: 25 });
    setupEvolutionStore();
    renderEvolution("run-001", run);
    const budgetEls = screen.getAllByText(/\$25\.00/);
    expect(budgetEls.length).toBeGreaterThanOrEqual(1);
  });

  it("显示目标列表", () => {
    renderEvolution();
    expect(screen.getByText("目标1")).toBeInTheDocument();
    expect(screen.getByText("目标2")).toBeInTheDocument();
  });

  it("显示终止条件", () => {
    renderEvolution();
    expect(screen.getByText("终止条件1")).toBeInTheDocument();
  });

  it("显示运行统计信息", () => {
    renderEvolution();
    expect(screen.getByText("5")).toBeInTheDocument(); // totalTasksCompleted
  });

  it("显示失败任务和重试按钮", async () => {
    const failedTask = makeTaskDef({ id: "fail-001", status: "failed", content: "失败的任务", errorMessage: "超时" });
    mockCall.mockImplementation(async (method: string) => {
      if (method === "queue.list") return { queue: [] };
      if (method === "run.commits") return [];
      if (method === "run.lessons") return [];
      if (method === "run.tasks") return [failedTask];
      return null;
    });
    renderEvolution();
    await waitFor(() => {
      expect(screen.getByText("失败的任务")).toBeInTheDocument();
      expect(screen.getByText("再试一次")).toBeInTheDocument();
    });
  });

  it("点击重试调用 task.retry", async () => {
    const user = userEvent.setup();
    const failedTask = makeTaskDef({ id: "fail-001", status: "failed", content: "失败的任务" });
    mockCall.mockImplementation(async (method: string) => {
      if (method === "queue.list") return { queue: [] };
      if (method === "run.commits") return [];
      if (method === "run.lessons") return [];
      if (method === "run.tasks") return [failedTask];
      return null;
    });
    renderEvolution();
    await waitFor(() => {
      expect(screen.getByText("再试一次")).toBeInTheDocument();
    });
    await user.click(screen.getByText("再试一次"));
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("task.retry", { runId: "run-001", taskId: "fail-001" });
    });
  });

  it("显示最终报告", async () => {
    const user = userEvent.setup();
    const run = makeRun({ finalReport: "这是最终报告内容" });
    renderEvolution("run-001", run);
    // Click the report tab to show the report content
    await user.click(screen.getByText("报告"));
    await waitFor(() => {
      expect(screen.getByText("这是最终报告内容")).toBeInTheDocument();
    });
  });
});
