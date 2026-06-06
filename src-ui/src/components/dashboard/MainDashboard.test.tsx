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

vi.mock("../chat/MasterChat", () => ({
  MasterChat: () => <div data-testid="master-chat">AI Chat</div>,
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

  it("渲染 AI 聊天组件", () => {
    renderDashboard();
    expect(screen.getByTestId("master-chat")).toBeInTheDocument();
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
    expect(skeletons.length).toBe(3);
  });

  it("空任务列表显示提示", () => {
    renderDashboard();
    expect(screen.getByText(/暂无任务/)).toBeInTheDocument();
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

  it("显示任务数量标签", () => {
    const tasks = [makeTask(), makeTask()];
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
    expect(screen.getByText(/任务 · 2/)).toBeInTheDocument();
  });

  it("收起面板后显示展开按钮", async () => {
    const user = userEvent.setup();
    renderDashboard();
    const closeBtn = screen.getByLabelText("收起面板");
    await user.click(closeBtn);
    expect(screen.getByLabelText("展开任务面板")).toBeInTheDocument();
  });
});
