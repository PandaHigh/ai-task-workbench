import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

const mockCall = vi.fn();

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ call: mockCall, connected: true }),
}));

vi.mock("../../lib/utils", () => ({
  formatTimestamp: (ts: number) => new Date(ts).toLocaleTimeString(),
}));

import { ActivityTimeline } from "./ActivityTimeline";

describe("ActivityTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockResolvedValue({ activities: [] });
  });

  it("should show empty state when no activities", async () => {
    await act(async () => { render(<ActivityTimeline runId="run-1" />); });
    expect(screen.getByText("暂无活动记录")).toBeInTheDocument();
  });

  it("should call activity.list on mount", async () => {
    await act(async () => { render(<ActivityTimeline runId="run-1" />); });
    expect(mockCall).toHaveBeenCalledWith("activity.list", { runId: "run-1", limit: 50 });
  });

  it("should render activities", async () => {
    const activities = [
      { id: "a1", action: "task.created", userId: "user", timestamp: Date.now(), details: {} },
      { id: "a2", action: "task.completed", userId: "ai", timestamp: Date.now(), details: {} },
    ];
    mockCall.mockResolvedValue({ activities });
    await act(async () => { render(<ActivityTimeline runId="run-1" />); });
    expect(screen.getByText("创建任务")).toBeInTheDocument();
    expect(screen.getByText("任务完成")).toBeInTheDocument();
  });

  it("should show activity count", async () => {
    const activities = [
      { id: "a1", action: "task.created", userId: "user", timestamp: Date.now(), details: {} },
    ];
    mockCall.mockResolvedValue({ activities });
    await act(async () => { render(<ActivityTimeline runId="run-1" />); });
    expect(screen.getByText(/活动 \(1\)/)).toBeInTheDocument();
  });

  it("should render refresh button", async () => {
    const activities = [
      { id: "a1", action: "task.created", userId: "user", timestamp: Date.now(), details: {} },
    ];
    mockCall.mockResolvedValue({ activities });
    await act(async () => { render(<ActivityTimeline runId="run-1" />); });
    const btn = screen.getByText("刷新");
    expect(btn).toBeInTheDocument();
    await act(async () => { fireEvent.click(btn); });
    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it("should display user IDs", async () => {
    const activities = [
      { id: "a1", action: "task.created", userId: "test-user", timestamp: Date.now(), details: {} },
    ];
    mockCall.mockResolvedValue({ activities });
    await act(async () => { render(<ActivityTimeline runId="run-1" />); });
    expect(screen.getByText("test-user")).toBeInTheDocument();
  });

  it("should handle load failure gracefully", async () => {
    mockCall.mockRejectedValue(new Error("fail"));
    await act(async () => { render(<ActivityTimeline runId="run-1" />); });
    expect(screen.getByText("暂无活动记录")).toBeInTheDocument();
  });
});
