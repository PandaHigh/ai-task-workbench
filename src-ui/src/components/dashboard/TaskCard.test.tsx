import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TaskCard } from "./TaskCard";
import type { ExecutionRun } from "@ai-workbench/shared";

vi.mock("../../stores/task-store", () => ({
  useTaskStore: vi.fn(),
}));

vi.mock("../../hooks/useKeyboard", () => ({
  setModalActive: vi.fn(),
  useRegisterShortcut: vi.fn(),
}));

import { useTaskStore } from "../../stores/task-store";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function makeRun(overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id: "run-001",
    workingDir: "/home/user/project",
    goals: ["测试任务目标"],
    terminationConditions: ["条件A", "条件B"],
    status: "idle",
    totalCostUsd: 0,
    totalTasksCompleted: 3,
    startedAt: Date.now() - 60_000,
    completedAt: undefined,
    ...overrides,
  };
}

function renderCard(task: ExecutionRun, onDelete?: () => void) {
  return render(
    <MemoryRouter>
      <TaskCard task={task} onDelete={onDelete} />
    </MemoryRouter>,
  );
}

describe("TaskCard", () => {
  const mockDeleteTask = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTaskStore).mockReturnValue({
      tasks: [],
      activeRunId: null,
      loading: false,
      loadTasks: vi.fn(),
      addTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: mockDeleteTask,
      setActiveRun: vi.fn(),
    });
  });

  it("渲染任务目标文本", () => {
    renderCard(makeRun());
    expect(screen.getByText("测试任务目标")).toBeInTheDocument();
  });

  it("无目标时显示未命名任务", () => {
    renderCard(makeRun({ goals: [] }));
    expect(screen.getByText("未命名任务")).toBeInTheDocument();
  });

  it("显示正确的状态标签 - idle", () => {
    renderCard(makeRun({ status: "idle" }));
    expect(screen.getByText("空闲")).toBeInTheDocument();
  });

  it("显示正确的状态标签 - running", () => {
    renderCard(makeRun({ status: "running" }));
    expect(screen.getByText("运行中")).toBeInTheDocument();
  });

  it("显示正确的状态标签 - completed", () => {
    renderCard(makeRun({ status: "completed", completedAt: Date.now() }));
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });

  it("显示正确的状态标签 - failed", () => {
    renderCard(makeRun({ status: "failed", completedAt: Date.now() }));
    expect(screen.getByText("失败")).toBeInTheDocument();
  });

  it("显示终止条件（截断到2个）", () => {
    renderCard(makeRun({ terminationConditions: ["A", "B", "C", "D"] }));
    expect(screen.getByText(/A; B/)).toBeInTheDocument();
    expect(screen.getByText(/\+2/)).toBeInTheDocument();
  });

  it("显示工作目录名", () => {
    renderCard(makeRun({ workingDir: "/home/user/my-project" }));
    expect(screen.getByText(/my-project/)).toBeInTheDocument();
  });

  it("显示费用", () => {
    renderCard(makeRun({ totalCostUsd: 1.2345 }));
    expect(screen.getByText("$1.2345")).toBeInTheDocument();
  });

  it("费用为0时不显示", () => {
    renderCard(makeRun({ totalCostUsd: 0 }));
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("点击卡片导航到 evolution 页面", async () => {
    const user = userEvent.setup();
    renderCard(makeRun({ id: "run-xyz789" }));
    await user.click(screen.getByText("测试任务目标"));
    expect(mockNavigate).toHaveBeenCalledWith("/evolution/run-xyz789");
  });

  it("显示删除确认弹窗", async () => {
    const user = userEvent.setup();
    renderCard(makeRun());
    const deleteBtn = screen.getByLabelText("删除任务");
    await user.click(deleteBtn);
    expect(screen.getByText("确定删除此任务？所有相关数据将被清除。")).toBeInTheDocument();
  });

  it("确认删除后调用 deleteTask 和 onDelete", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    mockDeleteTask.mockResolvedValue(undefined);
    renderCard(makeRun({ id: "run-del" }), onDelete);
    await user.click(screen.getByLabelText("删除任务"));
    await user.click(screen.getByText("删除"));
    expect(mockDeleteTask).toHaveBeenCalledWith("run-del");
    await vi.waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
  });

  it("取消删除关闭弹窗", async () => {
    const user = userEvent.setup();
    renderCard(makeRun());
    await user.click(screen.getByLabelText("删除任务"));
    await user.click(screen.getByText("取消"));
    expect(screen.queryByText("确定删除此任务？所有相关数据将被清除。")).not.toBeInTheDocument();
  });

  it("未开始的任务显示'未开始'", () => {
    renderCard(makeRun({ startedAt: undefined }));
    expect(screen.getByText("未开始")).toBeInTheDocument();
  });

  it("running 状态下启动计时器更新", () => {
    vi.useFakeTimers();
    renderCard(makeRun({ status: "running", startedAt: Date.now() - 5000 }));
    const el = screen.getByText(/1s/);
    expect(el).toBeInTheDocument();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
  });
});
