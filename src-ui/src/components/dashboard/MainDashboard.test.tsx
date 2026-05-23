import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, createMockRun } from "../../test/test-utils";
import { MainDashboard } from "../dashboard/MainDashboard";
import { useTaskStore } from "../../stores/task-store";

// Mock useEngine hook
const mockConnected = vi.fn().mockReturnValue({ connected: true, call: vi.fn() });
vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => mockConnected(),
}));

vi.mock("../../lib/engine-client", () => ({
  engineClient: {
    call: vi.fn().mockResolvedValue([]),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    onNotification: vi.fn().mockReturnValue(() => {}),
  },
}));

// Mock RobotMascot to simplify rendering
vi.mock("../dashboard/RobotMascot", () => ({
  RobotMascot: ({ mood }: { mood: string }) => (
    <div data-testid="robot-mascot" data-mood={mood}>Robot</div>
  ),
}));

describe("MainDashboard", () => {
  let loadTasksSpy: Mock<() => Promise<void>>;

  beforeEach(() => {
    useTaskStore.setState({ tasks: [], loading: false, activeRunId: null });
    vi.clearAllMocks();
    mockConnected.mockReturnValue({ connected: true, call: vi.fn() });
    // Mock loadTasks to be a no-op to prevent async state changes
    loadTasksSpy = vi.fn().mockResolvedValue(undefined);
    useTaskStore.setState({ loadTasks: loadTasksSpy } as Partial<typeof useTaskStore.getState>);
  });

  it("renders header with connection status when connected", () => {
    renderWithProviders(<MainDashboard />);

    expect(screen.getByText("任务总览")).toBeInTheDocument();
    expect(screen.getByText(/已连接引擎/)).toBeInTheDocument();
  });

  it("shows disconnected status when engine is not connected", () => {
    mockConnected.mockReturnValue({ connected: false, call: vi.fn() });

    renderWithProviders(<MainDashboard />);

    expect(screen.getByText("引擎未连接")).toBeInTheDocument();
  });

  it("shows RobotMascot with idle mood when connected", () => {
    renderWithProviders(<MainDashboard />);

    expect(screen.getByTestId("robot-mascot")).toHaveAttribute("data-mood", "idle");
  });

  it("shows RobotMascot with error mood when disconnected", () => {
    mockConnected.mockReturnValue({ connected: false, call: vi.fn() });

    renderWithProviders(<MainDashboard />);

    expect(screen.getByTestId("robot-mascot")).toHaveAttribute("data-mood", "error");
  });

  it("shows skeleton loading state", () => {
    useTaskStore.setState({ tasks: [], loading: true });
    mockConnected.mockReturnValue({ connected: true, call: vi.fn() });

    renderWithProviders(<MainDashboard />);

    const skeletons = document.querySelectorAll(".skeleton-shimmer");
    expect(skeletons.length).toBe(6);
  });

  it("shows empty state when no tasks exist and not loading", () => {
    useTaskStore.setState({ tasks: [], loading: false });

    renderWithProviders(<MainDashboard />);

    expect(screen.getByText("还没有任务")).toBeInTheDocument();
    expect(screen.getByText("创建你的第一个 AI 任务开始使用")).toBeInTheDocument();
    expect(screen.getByText("+ 新建任务")).toBeInTheDocument();
  });

  it("navigates to /wizard when clicking new task button", async () => {
    useTaskStore.setState({ tasks: [], loading: false });

    renderWithProviders(<MainDashboard />);

    const newTaskBtn = screen.getByText("+ 新建任务");
    await userEvent.click(newTaskBtn);
    expect(newTaskBtn).toBeInTheDocument();
  });

  it("renders task cards when tasks exist", () => {
    const tasks = [
      createMockRun({
        id: "run-1",
        goals: ["Fix all bugs"],
        status: "idle",
        workingDir: "/home/user/project-a",
        terminationConditions: ["Tests pass"],
      }),
      createMockRun({
        id: "run-2",
        goals: ["Add features"],
        status: "running",
        workingDir: "/home/user/project-b",
        startedAt: Date.now() - 60000,
        terminationConditions: [],
      }),
    ];

    useTaskStore.setState({ tasks, loading: false });

    renderWithProviders(<MainDashboard />);

    expect(screen.getByText("Fix all bugs")).toBeInTheDocument();
    expect(screen.getByText("Add features")).toBeInTheDocument();
    expect(screen.getByText(/2 个任务/)).toBeInTheDocument();
  });

  it("shows task count in header", () => {
    const tasks = [
      createMockRun({ id: "run-1" }),
      createMockRun({ id: "run-2" }),
      createMockRun({ id: "run-3" }),
    ];

    useTaskStore.setState({ tasks, loading: false });

    renderWithProviders(<MainDashboard />);

    expect(screen.getByText(/3 个任务/)).toBeInTheDocument();
  });

  it("calls loadTasks when connected", () => {
    renderWithProviders(<MainDashboard />);

    expect(loadTasksSpy).toHaveBeenCalled();
  });

  it("does not call loadTasks when disconnected", () => {
    mockConnected.mockReturnValue({ connected: false, call: vi.fn() });
    const localSpy = vi.fn().mockResolvedValue(undefined);
    useTaskStore.setState({ loadTasks: localSpy } as Partial<typeof useTaskStore.getState>);

    renderWithProviders(<MainDashboard />);

    expect(localSpy).not.toHaveBeenCalled();
  });

  it("renders task cards in a grid with correct task data", () => {
    const tasks = [
      createMockRun({
        id: "run-abc",
        goals: ["Goal A", "Goal B"],
        status: "completed",
        workingDir: "/projects/my-app",
        terminationConditions: ["All tests pass"],
        totalCostUsd: 1.2345,
        totalTasksCompleted: 3,
        startedAt: Date.now() - 7200000,
        completedAt: Date.now(),
      }),
    ];

    useTaskStore.setState({ tasks, loading: false });

    renderWithProviders(<MainDashboard />);

    expect(screen.getByText("Goal A")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("$1.2345")).toBeInTheDocument();
    expect(screen.getByText(/目标: 2 \| 已完成: 3/)).toBeInTheDocument();
  });
});
