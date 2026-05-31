import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const callsMap: Record<string, ReturnType<typeof vi.fn>> = {};
let mockPendingApprovals: unknown[] = [];
const mockRemoveApproval = vi.fn();

vi.mock("../../stores/approval-store", () => ({
  useApprovalStore: (selector: (s: any) => any) =>
    selector({ pendingApprovals: mockPendingApprovals, removeApproval: mockRemoveApproval }),
}));

vi.mock("../../lib/engine-client", () => ({
  engineClient: { call: (...args: any[]) => { callsMap.call ??= vi.fn(); return callsMap.call(...args); } },
}));

vi.mock("../common/Toast", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

import { ApprovalPanel } from "./ApprovalPanel";

const makeApproval = (overrides = {}) => ({
  id: "apr-1",
  runId: "run-1",
  taskId: "t1",
  checkpointType: "borderline_score",
  summary: "Score is near threshold",
  contextData: {},
  ...overrides,
});

describe("ApprovalPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPendingApprovals = [];
    callsMap.call = vi.fn().mockResolvedValue({});
  });

  it("should return null when no pending approvals", () => {
    const { container } = render(<ApprovalPanel />);
    expect(container.innerHTML).toBe("");
  });

  it("should render dialog when approval is pending", () => {
    mockPendingApprovals = [makeApproval()];
    render(<ApprovalPanel />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("should show checkpoint type label", () => {
    mockPendingApprovals = [makeApproval({ checkpointType: "borderline_score" })];
    render(<ApprovalPanel />);
    expect(screen.getByText("评分接近阈值")).toBeInTheDocument();
  });

  it("should show summary text", () => {
    mockPendingApprovals = [makeApproval({ summary: "Test summary" })];
    render(<ApprovalPanel />);
    expect(screen.getByText("Test summary")).toBeInTheDocument();
  });

  it("should call approve on button click", async () => {
    mockPendingApprovals = [makeApproval()];
    render(<ApprovalPanel />);
    await act(async () => { fireEvent.click(screen.getByText("通过 (Y)")); });
    expect(callsMap.call).toHaveBeenCalledWith("approval.respond", expect.objectContaining({ action: "approve" }));
  });

  it("should call reject on button click", async () => {
    mockPendingApprovals = [makeApproval()];
    render(<ApprovalPanel />);
    await act(async () => { fireEvent.click(screen.getByText("拒绝 (N)")); });
    expect(callsMap.call).toHaveBeenCalledWith("approval.respond", expect.objectContaining({ action: "reject" }));
  });

  it("should show modify button only for goal_stagnation", () => {
    mockPendingApprovals = [makeApproval({ checkpointType: "goal_stagnation" })];
    render(<ApprovalPanel />);
    expect(screen.getByText("重定向 (M)")).toBeInTheDocument();
  });

  it("should not show modify button for other checkpoints", () => {
    mockPendingApprovals = [makeApproval({ checkpointType: "borderline_score" })];
    render(<ApprovalPanel />);
    expect(screen.queryByText("重定向 (M)")).not.toBeInTheDocument();
  });

  it("should show score for borderline_score checkpoint", () => {
    mockPendingApprovals = [makeApproval({
      checkpointType: "borderline_score",
      contextData: { score: { overall: 0.65, passed: true, reasoning: "Acceptable quality" } },
    })];
    render(<ApprovalPanel />);
    expect(screen.getByText("65%")).toBeInTheDocument();
    expect(screen.getByText("PASS")).toBeInTheDocument();
  });

  it("should show diff stats for risky_commit checkpoint", () => {
    mockPendingApprovals = [makeApproval({
      checkpointType: "risky_commit",
      contextData: { diffStats: { filesChanged: 15, linesChanged: 200, hasCriticalFiles: true } },
    })];
    render(<ApprovalPanel />);
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("涉及关键文件")).toBeInTheDocument();
  });

  it("should show queue count when multiple approvals", () => {
    mockPendingApprovals = [makeApproval({ id: "a1" }), makeApproval({ id: "a2" })];
    render(<ApprovalPanel />);
    expect(screen.getByText("+1 个等待中")).toBeInTheDocument();
  });

  it("should respond to Y keyboard shortcut", async () => {
    mockPendingApprovals = [makeApproval()];
    render(<ApprovalPanel />);
    await act(async () => { fireEvent.keyDown(window, { key: "y" }); });
    expect(callsMap.call).toHaveBeenCalledWith("approval.respond", expect.objectContaining({ action: "approve" }));
  });

  it("should respond to N keyboard shortcut", async () => {
    mockPendingApprovals = [makeApproval()];
    render(<ApprovalPanel />);
    await act(async () => { fireEvent.keyDown(window, { key: "n" }); });
    expect(callsMap.call).toHaveBeenCalledWith("approval.respond", expect.objectContaining({ action: "reject" }));
  });

  it("should not respond to keyboard when input is focused", async () => {
    mockPendingApprovals = [makeApproval()];
    render(<ApprovalPanel />);
    const input = screen.getByPlaceholderText("输入附加指令（可选）...");
    fireEvent.focus(input);
    await act(async () => { fireEvent.keyDown(input, { key: "y" }); });
    expect(callsMap.call).not.toHaveBeenCalled();
  });
});
