import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

const mockCall = vi.fn();
const mockToast = { error: vi.fn(), success: vi.fn(), info: vi.fn() };

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ call: mockCall, connected: true }),
}));

vi.mock("../common/Toast", () => ({
  useToast: () => mockToast,
}));

vi.mock("../../lib/utils", () => ({
  formatTimestamp: (ts: number) => new Date(ts).toLocaleTimeString(),
}));

import { TaskComments } from "./TaskComments";

describe("TaskComments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockResolvedValue({ comments: [] });
  });

  it("should call comment.list on mount", async () => {
    await act(async () => {
      render(<TaskComments runId="run-1" taskId="t1" />);
    });
    expect(mockCall).toHaveBeenCalledWith("comment.list", { runId: "run-1", taskId: "t1" });
  });

  it("should render existing comments", async () => {
    const comments = [{ id: "c1", displayName: "Alice", content: "Great work", createdAt: Date.now(), userId: "u1" }];
    mockCall.mockResolvedValue({ comments });
    await act(async () => {
      render(<TaskComments runId="run-1" taskId="t1" />);
    });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Great work")).toBeInTheDocument();
  });

  it("should update input value on typing", async () => {
    await act(async () => {
      render(<TaskComments runId="run-1" taskId="t1" />);
    });
    const input = screen.getByPlaceholderText("添加评论...");
    fireEvent.change(input, { target: { value: "New comment" } });
    expect(input).toHaveValue("New comment");
  });

  it("should submit comment on send button click", async () => {
    mockCall.mockResolvedValueOnce({ comments: [] });
    mockCall.mockResolvedValueOnce({}); // comment.create
    mockCall.mockResolvedValueOnce({ comments: [] }); // reload
    await act(async () => {
      render(<TaskComments runId="run-1" taskId="t1" />);
    });
    const input = screen.getByPlaceholderText("添加评论...");
    fireEvent.change(input, { target: { value: "Test comment" } });
    await act(async () => {
      fireEvent.click(screen.getByText("发送"));
    });
    expect(mockCall).toHaveBeenCalledWith("comment.create", expect.objectContaining({ content: "Test comment" }));
  });

  it("should not submit empty comment", async () => {
    await act(async () => {
      render(<TaskComments runId="run-1" taskId="t1" />);
    });
    await act(async () => {
      fireEvent.click(screen.getByText("发送"));
    });
    expect(mockCall).toHaveBeenCalledTimes(1); // only the initial load
  });

  it("should disable send button when text is empty", async () => {
    await act(async () => {
      render(<TaskComments runId="run-1" taskId="t1" />);
    });
    expect(screen.getByText("发送")).toBeDisabled();
  });

  it("should show toast error on submit failure", async () => {
    mockCall.mockResolvedValueOnce({ comments: [] });
    mockCall.mockRejectedValueOnce(new Error("Submit failed"));
    await act(async () => {
      render(<TaskComments runId="run-1" taskId="t1" />);
    });
    const input = screen.getByPlaceholderText("添加评论...");
    fireEvent.change(input, { target: { value: "Will fail" } });
    await act(async () => {
      fireEvent.click(screen.getByText("发送"));
    });
    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining("评论失败"));
  });
});
