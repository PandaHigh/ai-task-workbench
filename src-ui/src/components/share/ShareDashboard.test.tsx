import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../../hooks/useShareView", () => ({
  useShareView: () => mockShareView,
}));

vi.mock("../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ token: "test-token" }),
}));

import { ShareDashboard } from "./ShareDashboard";

const mockRefresh = vi.fn();
let mockShareView: ReturnType<typeof import("../../hooks/useShareView")["useShareView"]>;

describe("ShareDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShareView = {
      loading: false,
      error: "",
      run: {
        id: "r1",
        workingDir: "/test",
        goals: ["Test goal"],
        terminationConditions: [],
        status: "running",
        startedAt: Date.now() - 30_000,
        completedAt: undefined,
        totalCostUsd: 1.5,
        totalTasksCompleted: 2,
      } as any,
      tasks: [
        { id: "t1", content: "Task 1", status: "completed", type: "user_defined", priority: 1, completedAt: Date.now() } as any,
        { id: "t2", content: "Task 2", status: "failed", type: "ai_generated", priority: 2, errorMessage: "Error msg" } as any,
      ],
      commits: [],
      lessons: [],
      queue: [
        { id: "t3", content: "Queued task", type: "ai_generated", priority: 3, status: "queued" } as any,
      ],
      report: null,
      logs: [
        { id: 1, timestamp: Date.now(), level: "info", source: "engine", message: "Test log" },
      ],
      call: vi.fn(),
      refresh: mockRefresh,
      wsConnected: true,
    };
  });

  it("should show loading state", () => {
    mockShareView = { ...mockShareView, loading: true };
    render(<ShareDashboard />);
    expect(screen.getByText("加载分享看板...")).toBeInTheDocument();
  });

  it("should show error state", () => {
    mockShareView = { ...mockShareView, error: "Something went wrong", loading: false };
    render(<ShareDashboard />);
    expect(screen.getByText("加载失败")).toBeInTheDocument();
    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("should show expired state for expired tokens", () => {
    mockShareView = { ...mockShareView, error: "Token has expired", loading: false };
    render(<ShareDashboard />);
    expect(screen.getByText("此分享链接已过期")).toBeInTheDocument();
    expect(screen.getByText("请联系分享者获取新的链接")).toBeInTheDocument();
  });

  it("should render dashboard with task queue and logs", () => {
    render(<ShareDashboard />);
    expect(screen.getAllByText("Test goal").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("实时")).toBeInTheDocument();
    expect(screen.getByText("协作")).toBeInTheDocument();
  });

  it("should display task queue", () => {
    render(<ShareDashboard />);
    expect(screen.getByText("任务队列 (1)")).toBeInTheDocument();
    expect(screen.getByText("Queued task")).toBeInTheDocument();
  });

  it("should display completed tasks", () => {
    render(<ShareDashboard />);
    expect(screen.getByText("已完成 (1)")).toBeInTheDocument();
    expect(screen.getByText("Task 1")).toBeInTheDocument();
  });

  it("should display failed tasks with retry button", () => {
    render(<ShareDashboard />);
    expect(screen.getByText("失败 (1)")).toBeInTheDocument();
    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("should show add task button in collaborate mode", () => {
    render(<ShareDashboard />);
    expect(screen.getByText("+ 新增任务")).toBeInTheDocument();
  });

  it("should show budget bar always", () => {
    render(<ShareDashboard />);
    expect(screen.getByText(/预算消耗/)).toBeInTheDocument();
    expect(screen.getByText(/\$1\.50/)).toBeInTheDocument();
  });

  it("should show connection status", () => {
    render(<ShareDashboard />);
    expect(screen.getByText("WebSocket 实时连接")).toBeInTheDocument();
  });

  it("should show polling mode when disconnected", () => {
    mockShareView = { ...mockShareView, wsConnected: false };
    render(<ShareDashboard />);
    expect(screen.getByText("轮询中")).toBeInTheDocument();
    expect(screen.getByText("HTTP 轮询模式")).toBeInTheDocument();
  });

  it("should switch tabs", async () => {
    render(<ShareDashboard />);
    expect(screen.getByText("Test log")).toBeInTheDocument();

    const commitTab = screen.getByText(/Git 提交/);
    fireEvent.click(commitTab);

    expect(screen.getByText("暂无提交")).toBeInTheDocument();
  });

  it("should show refresh button", () => {
    render(<ShareDashboard />);
    const refreshBtns = screen.getAllByText("刷新");
    expect(refreshBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("should call refresh on button click", async () => {
    render(<ShareDashboard />);
    const refreshBtns = screen.getAllByText("刷新");
    fireEvent.click(refreshBtns[0]);
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("should open and close add task modal", async () => {
    render(<ShareDashboard />);
    fireEvent.click(screen.getByText("+ 新增任务"));
    expect(screen.getByText("新增任务")).toBeInTheDocument();

    fireEvent.click(screen.getByText("取消"));
    expect(screen.queryByText("新增任务")).not.toBeInTheDocument();
  });
});
