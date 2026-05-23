import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, createMockRun } from "../../test/test-utils";
import { TaskCard } from "../dashboard/TaskCard";
import { useTaskStore } from "../../stores/task-store";
import { engineClient } from "../../lib/engine-client";

vi.mock("../../lib/engine-client", () => ({
  engineClient: {
    call: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    onNotification: vi.fn().mockReturnValue(() => {}),
  },
}));

describe("TaskCard", () => {
  beforeEach(() => {
    useTaskStore.setState({ tasks: [], loading: false, activeRunId: null });
    vi.clearAllMocks();
  });

  it("renders task status badge", () => {
    const task = createMockRun({ id: "run-1", status: "idle", goals: ["Test goal"] });

    renderWithProviders(<TaskCard task={task} />);

    expect(screen.getByText("空闲")).toBeInTheDocument();
    expect(screen.getByText("Test goal")).toBeInTheDocument();
  });

  it("renders running status with elapsed time", () => {
    const task = createMockRun({
      id: "run-2",
      status: "running",
      goals: ["Running task"],
      startedAt: Date.now() - 65000, // 65 seconds ago
    });

    renderWithProviders(<TaskCard task={task} />);

    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("1m 5s")).toBeInTheDocument();
  });

  it("renders completed status", () => {
    const task = createMockRun({ id: "run-3", status: "completed", goals: ["Done"] });

    renderWithProviders(<TaskCard task={task} />);

    expect(screen.getByText("已完成")).toBeInTheDocument();
  });

  it("renders paused status", () => {
    const task = createMockRun({ id: "run-4", status: "paused", goals: ["Paused"] });

    renderWithProviders(<TaskCard task={task} />);

    expect(screen.getByText("已暂停")).toBeInTheDocument();
  });

  it("renders failed status", () => {
    const task = createMockRun({ id: "run-5", status: "failed", goals: ["Failed"] });

    renderWithProviders(<TaskCard task={task} />);

    expect(screen.getByText("失败")).toBeInTheDocument();
  });

  it("shows cost when > 0", () => {
    const task = createMockRun({
      id: "run-6",
      status: "completed",
      goals: ["Costly task"],
      totalCostUsd: 2.5678,
    });

    renderWithProviders(<TaskCard task={task} />);

    expect(screen.getByText("$2.5678")).toBeInTheDocument();
  });

  it("does not show cost when 0", () => {
    const task = createMockRun({
      id: "run-7",
      status: "idle",
      goals: ["Free task"],
      totalCostUsd: 0,
    });

    renderWithProviders(<TaskCard task={task} />);

    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
  });

  it("shows termination conditions (up to 2)", () => {
    const task = createMockRun({
      id: "run-8",
      status: "idle",
      goals: ["Task"],
      terminationConditions: ["Tests pass", "Build OK", "Lint clean"],
    });

    renderWithProviders(<TaskCard task={task} />);

    expect(screen.getByText(/Tests pass/)).toBeInTheDocument();
    expect(screen.getByText(/\+1/)).toBeInTheDocument();
  });

  it("shows working directory name", () => {
    const task = createMockRun({
      id: "run-9",
      status: "idle",
      goals: ["Task"],
      workingDir: "/home/user/my-project",
    });

    renderWithProviders(<TaskCard task={task} />);

    expect(screen.getByText(/目录: my-project/)).toBeInTheDocument();
  });

  it("shows goals count and completed count", () => {
    const task = createMockRun({
      id: "run-10",
      status: "running",
      goals: ["Goal 1", "Goal 2", "Goal 3"],
      totalTasksCompleted: 5,
    });

    renderWithProviders(<TaskCard task={task} />);

    expect(screen.getByText(/目标: 3 \| 已完成: 5/)).toBeInTheDocument();
  });

  it("navigates to evolution page on click", async () => {
    const task = createMockRun({ id: "run-nav", status: "idle", goals: ["Clickable"] });

    renderWithProviders(<TaskCard task={task} />);

    const card = screen.getByText("Clickable").closest(".glass-card-hover");
    expect(card).toBeTruthy();
  });

  it("shows delete confirmation dialog", async () => {
    const task = createMockRun({ id: "run-del", status: "idle", goals: ["Deletable"] });

    renderWithProviders(<TaskCard task={task} />);

    const deleteBtn = screen.getByLabelText("删除任务");
    await userEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByText(/确定删除此任务？/)).toBeInTheDocument();
    });
    expect(screen.getByText(/所有相关数据将被清除。/)).toBeInTheDocument();
  });

  it("deletes task on confirm", async () => {
    vi.mocked(engineClient.call).mockResolvedValue(undefined);

    const task = createMockRun({ id: "run-del2", status: "idle", goals: ["To delete"] });
    const onDelete = vi.fn();

    renderWithProviders(<TaskCard task={task} onDelete={onDelete} />);

    const deleteBtn = screen.getByLabelText("删除任务");
    await userEvent.click(deleteBtn);

    await userEvent.click(screen.getByText("删除"));

    await waitFor(() => {
      expect(engineClient.call).toHaveBeenCalledWith("run.delete", { runId: "run-del2" });
      expect(onDelete).toHaveBeenCalled();
    });
  });

  it("cancels delete on cancel button", async () => {
    const task = createMockRun({ id: "run-cancel", status: "idle", goals: ["Cancel me"] });

    renderWithProviders(<TaskCard task={task} />);

    const deleteBtn = screen.getByLabelText("删除任务");
    await userEvent.click(deleteBtn);

    await userEvent.click(screen.getByText("取消"));

    await waitFor(() => {
      expect(screen.queryByText("确定删除此任务？")).not.toBeInTheDocument();
    });
  });

  it("shows 未开始 for tasks without startedAt", () => {
    const task = createMockRun({
      id: "run-nostart",
      status: "idle",
      goals: ["No start"],
    });

    renderWithProviders(<TaskCard task={task} />);

    expect(screen.getByText("未开始")).toBeInTheDocument();
  });

  it("shows 未命名任务 when goals array is empty", () => {
    const task = createMockRun({
      id: "run-noname",
      status: "idle",
      goals: [],
    });

    renderWithProviders(<TaskCard task={task} />);

    expect(screen.getByText("未命名任务")).toBeInTheDocument();
  });
});
