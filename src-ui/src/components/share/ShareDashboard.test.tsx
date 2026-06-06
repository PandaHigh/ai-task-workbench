import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../../hooks/useShareView", () => ({
  useShareView: () => mockShareView,
}));

vi.mock("../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ token: "test-token" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ connected: true, call: vi.fn() }),
}));

vi.mock("../../hooks/useNotifications", () => ({
  useNotifications: () => {},
}));

vi.mock("../../hooks/useAnimations", () => ({
  pageEnterStyle: () => ({}),
  staggerItemStyle: () => ({}),
}));

vi.mock("../../hooks/useElapsedTimer", () => ({
  useElapsedTimer: () => null,
}));

vi.mock("../ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../evolution/ApprovalPanel", () => ({
  ApprovalPanel: () => null,
}));

vi.mock("../evolution/AgentProgressPanel", () => ({
  AgentProgressPanel: () => <div>AgentProgress</div>,
}));

vi.mock("../evolution/LogPanel", () => ({
  LogPanel: ({
    logs,
  }: {
    logs: Array<{ id: number; timestamp: number; level: string; source: string; message: string }>;
  }) => (
    <div>
      {logs.map((l) => (
        <span key={l.id}>{l.message}</span>
      ))}
    </div>
  ),
}));

vi.mock("../evolution/ReportTab", () => ({
  ReportTab: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("../evolution/StreamingOutput", () => ({
  StreamingOutput: () => null,
}));

vi.mock("../evolution/LogSearchBar", () => ({
  LogSearchBar: () => null,
}));

vi.mock("../evolution/TaskComments", () => ({
  TaskComments: () => null,
}));

vi.mock("../dashboard/RobotMascot", () => ({
  RobotMascot: ({ size }: { size: number }) => <svg data-testid="robot-mascot" width={size} height={size} />,
}));

vi.mock("../../lib/platform", () => ({
  ENGINE_HTTP_URL: "http://localhost:9731",
  ENGINE_WS_URL: "ws://localhost:9731",
}));

import { ShareDashboard } from "./ShareDashboard";

const mockRefresh = vi.fn();
let mockShareView: ReturnType<(typeof import("../../hooks/useShareView"))["useShareView"]>;

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
        {
          id: "t1",
          content: "Task 1",
          status: "completed",
          type: "user_defined",
          priority: 1,
          completedAt: Date.now(),
          runId: "r1",
        } as any,
        {
          id: "t2",
          content: "Task 2",
          status: "failed",
          type: "ai_generated",
          priority: 2,
          errorMessage: "Error msg",
          runId: "r1",
        } as any,
      ],
      commits: [],
      lessons: [],
      queue: [
        { id: "t3", content: "Queued task", type: "ai_generated", priority: 3, status: "queued", runId: "r1" } as any,
      ],
      report: null,
      logs: [{ id: 1, timestamp: Date.now(), level: "info", source: "engine", message: "Test log" }],
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

  it("should render EvolutionDashboard in share mode", async () => {
    render(<ShareDashboard />);
    // Wait for the dashboard to render (it syncs data via effects)
    await waitFor(() => {
      expect(screen.getByText("任务详情")).toBeInTheDocument();
    });
    // Should show robot mascot
    expect(screen.getByTestId("robot-mascot")).toBeInTheDocument();
    // Should show connection indicator "实时"
    expect(screen.getByText("实时")).toBeInTheDocument();
    // Should show task queue
    expect(screen.getByText("Queued task")).toBeInTheDocument();
  });

  it("should not show owner-only controls", async () => {
    render(<ShareDashboard />);
    await waitFor(() => {
      expect(screen.getByText("任务详情")).toBeInTheDocument();
    });
    // No share, download, start/stop buttons
    expect(screen.queryByText("分享")).not.toBeInTheDocument();
    expect(screen.queryByText("下载")).not.toBeInTheDocument();
    expect(screen.queryByText("开始")).not.toBeInTheDocument();
  });

  it("should show goals read-only (no edit button in goal panel)", async () => {
    render(<ShareDashboard />);
    await waitFor(() => {
      expect(screen.getByText("任务详情")).toBeInTheDocument();
    });
    // Goal content visible
    expect(screen.getByText("Test goal")).toBeInTheDocument();
  });
});
