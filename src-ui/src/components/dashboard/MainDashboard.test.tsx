import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MainDashboard } from "./MainDashboard";

vi.mock("../../hooks/useEngine", () => ({
  useEngine: vi.fn(),
}));

vi.mock("../../stores/task-store", () => ({
  useTaskStore: vi.fn(),
}));

import { useEngine } from "../../hooks/useEngine";
import { useTaskStore } from "../../stores/task-store";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-001",
    workingDir: "/home/user/project",
    goals: ["测试目标"],
    terminationConditions: [],
    status: "idle",
    totalCostUsd: 0,
    totalTasksCompleted: 0,
    ...overrides,
  } as import("@ai-workbench/shared").ExecutionRun;
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <MainDashboard />
    </MemoryRouter>,
  );
}

describe("MainDashboard", () => {
  const mockLoadTasks = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useEngine).mockReturnValue({
      connected: true,
      call: vi.fn(),
    });
    vi.mocked(useTaskStore).mockReturnValue({
      tasks: [],
      activeRunId: null,
      loading: false,
      loadTasks: mockLoadTasks,
      addTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      setActiveRun: vi.fn(),
    });
  });

  it("连接引擎时自动加载任务", () => {
    renderDashboard();
    expect(mockLoadTasks).toHaveBeenCalledTimes(1);
  });

  it("显示引擎未连接状态", () => {
    vi.mocked(useEngine).mockReturnValue({
      connected: false,
      call: vi.fn(),
    });
    renderDashboard();
    expect(screen.getByText("AI 未连接")).toBeInTheDocument();
  });

  it("显示已连接状态和任务数量", () => {
    vi.mocked(useTaskStore).mockReturnValue({
      tasks: [makeTask()],
      activeRunId: null,
      loading: false,
      loadTasks: mockLoadTasks,
      addTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      setActiveRun: vi.fn(),
    });
    renderDashboard();
    expect(screen.getByText(/AI 已就绪 · 共 1 个任务/)).toBeInTheDocument();
  });

  it("加载中显示骨架屏", () => {
    vi.mocked(useTaskStore).mockReturnValue({
      tasks: [],
      activeRunId: null,
      loading: true,
      loadTasks: mockLoadTasks,
      addTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      setActiveRun: vi.fn(),
    });
    renderDashboard();
    const skeletons = screen.getAllByRole("progressbar");
    expect(skeletons.length).toBe(6);
  });

  it("空任务列表显示空状态和新建按钮", () => {
    renderDashboard();
    expect(screen.getByText("欢迎使用 PandaAI")).toBeInTheDocument();
    expect(screen.getByText("开始第一个任务")).toBeInTheDocument();
  });

  it("点击新建任务按钮导航到 wizard", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await user.click(screen.getByText("开始第一个任务"));
    expect(mockNavigate).toHaveBeenCalledWith("/wizard");
  });

  it("渲染任务卡片列表", () => {
    const tasks = [makeTask({ id: "r1" }), makeTask({ id: "r2" }), makeTask({ id: "r3" })];
    vi.mocked(useTaskStore).mockReturnValue({
      tasks,
      activeRunId: null,
      loading: false,
      loadTasks: mockLoadTasks,
      addTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      setActiveRun: vi.fn(),
    });
    renderDashboard();
    expect(screen.getAllByText("测试目标").length).toBe(3);
  });

  it("点击任务卡片导航到 evolution 页面", async () => {
    const user = userEvent.setup();
    const tasks = [makeTask({ id: "run-abc123" })];
    vi.mocked(useTaskStore).mockReturnValue({
      tasks,
      activeRunId: null,
      loading: false,
      loadTasks: mockLoadTasks,
      addTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      setActiveRun: vi.fn(),
    });
    renderDashboard();
    await user.click(screen.getByText("测试目标"));
    expect(mockNavigate).toHaveBeenCalledWith("/evolution/run-abc123");
  });

  it("未连接时不会加载任务", () => {
    vi.mocked(useEngine).mockReturnValue({
      connected: false,
      call: vi.fn(),
    });
    renderDashboard();
    expect(mockLoadTasks).not.toHaveBeenCalled();
  });

  it("设置自动刷新定时器", () => {
    vi.useFakeTimers();
    renderDashboard();
    expect(mockLoadTasks).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(mockLoadTasks).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("卸载时清除定时器", () => {
    vi.useFakeTimers();
    const { unmount } = renderDashboard();
    unmount();
    vi.advanceTimersByTime(60_000);
    expect(mockLoadTasks).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
