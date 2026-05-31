import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { TaskDefinition } from "@ai-workbench/shared";

vi.mock("../common/EmptyState", () => ({
  EmptyState: ({ action }: { action?: { label: string; onClick: () => void } }) => (
    <div data-testid="empty-state">
      <span>没有待办任务</span>
      {action && <button onClick={action.onClick}>{action.label}</button>}
    </div>
  ),
}));

vi.mock("../common/Skeleton", () => ({
  Skeleton: ({ variant }: { variant: string }) => (
    <div data-testid="skeleton" data-variant={variant} />
  ),
}));

vi.mock("../../hooks/useAnimations", () => ({
  staggerItemStyle: () => ({}),
}));

vi.mock("./TaskComments", () => ({
  TaskComments: ({ taskId }: { taskId: string }) => (
    <div data-testid="task-comments" data-task-id={taskId} />
  ),
}));

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ call: vi.fn(), connected: true }),
}));

import { TaskQueue } from "./TaskQueue";

const makeTask = (overrides: Partial<TaskDefinition> = {}): TaskDefinition => ({
  id: "t1",
  content: "Test task",
  priority: 5,
  type: "ai_generated",
  status: "pending",
  timeoutMinutes: 30,
  ...overrides,
});

const defaultProps = {
  queue: [] as TaskDefinition[],
  activeTaskId: null as string | null,
  runningTask: null as TaskDefinition | null,
  completedTasks: [] as TaskDefinition[],
  failedTasks: [] as TaskDefinition[],
  runningElapsed: null as string | null,
  simpleMode: false,
  showLoading: false,
  isRunning: false,
  runId: undefined as string | undefined,
  showQueue: true,
  runStatus: undefined as string | undefined,
  onStart: vi.fn(),
  onSetActiveTask: vi.fn(),
  onMoveTask: vi.fn(),
  onDeleteTask: vi.fn(),
  onEditTask: vi.fn(),
  onRetry: vi.fn(),
  onShowAddModal: vi.fn(),
  onCloseQueue: vi.fn(),
};

describe("TaskQueue", () => {
  it("should render empty state when no tasks", () => {
    render(<TaskQueue {...defaultProps} />);
    expect(screen.getByText("没有待办任务")).toBeInTheDocument();
  });

  it("should show start button when not running and no tasks", () => {
    render(<TaskQueue {...defaultProps} />);
    expect(screen.getByText("开始")).toBeInTheDocument();
  });

  it("should show continue button when run completed", () => {
    render(<TaskQueue {...defaultProps} runStatus="completed" />);
    expect(screen.getByText("继续")).toBeInTheDocument();
  });

  it("should not show start button when running", () => {
    render(<TaskQueue {...defaultProps} isRunning={true} />);
    expect(screen.queryByText("开始")).not.toBeInTheDocument();
    expect(screen.queryByText("继续")).not.toBeInTheDocument();
  });

  it("should render loading skeletons", () => {
    render(<TaskQueue {...defaultProps} showLoading={true} />);
    expect(screen.getAllByTestId("skeleton")).toHaveLength(4);
  });

  it("should render queue items", () => {
    const queue = [makeTask({ id: "t1", content: "Task A" }), makeTask({ id: "t2", content: "Task B" })];
    render(<TaskQueue {...defaultProps} queue={queue} />);
    expect(screen.getByText("Task A")).toBeInTheDocument();
    expect(screen.getByText("Task B")).toBeInTheDocument();
  });

  it("should show task count in header", () => {
    const queue = [makeTask(), makeTask({ id: "t2" }), makeTask({ id: "t3" })];
    render(<TaskQueue {...defaultProps} queue={queue} />);
    expect(screen.getByText(/待办 \(3\)/)).toBeInTheDocument();
  });

  it("should call onSetActiveTask when clicking a task", () => {
    const onSetActiveTask = vi.fn();
    const queue = [makeTask({ id: "t1", content: "Click me" })];
    render(<TaskQueue {...defaultProps} queue={queue} onSetActiveTask={onSetActiveTask} />);
    fireEvent.click(screen.getByText("Click me"));
    expect(onSetActiveTask).toHaveBeenCalledWith("t1");
  });

  it("should call onShowAddModal when clicking add button", () => {
    const onShowAddModal = vi.fn();
    render(<TaskQueue {...defaultProps} onShowAddModal={onShowAddModal} />);
    fireEvent.click(screen.getByText("+ 添加任务"));
    expect(onShowAddModal).toHaveBeenCalled();
  });

  it("should call onRetry when clicking retry on failed task", () => {
    const onRetry = vi.fn();
    const failedTasks = [makeTask({ id: "f1", content: "Failed task", status: "failed", errorMessage: "oops" })];
    render(<TaskQueue {...defaultProps} failedTasks={failedTasks} onRetry={onRetry} />);
    fireEvent.click(screen.getByText("再试一次"));
    expect(onRetry).toHaveBeenCalledWith("f1");
  });

  it("should call onDeleteTask when clicking remove on failed task", () => {
    const onDeleteTask = vi.fn();
    const failedTasks = [makeTask({ id: "f1", content: "Failed task", status: "failed" })];
    render(<TaskQueue {...defaultProps} failedTasks={failedTasks} onDeleteTask={onDeleteTask} />);
    const removeButtons = screen.getAllByText("移除");
    fireEvent.click(removeButtons[0]);
    expect(onDeleteTask).toHaveBeenCalledWith("f1", "Failed task");
  });

  it("should render running task indicator", () => {
    const runningTask = makeTask({ id: "r1", content: "Running task", status: "running", startedAt: Date.now() });
    render(<TaskQueue {...defaultProps} runningTask={runningTask} runningElapsed="5s" runId="run-1" />);
    expect(screen.getByText("Running task")).toBeInTheDocument();
    expect(screen.getByText("工作中")).toBeInTheDocument();
    expect(screen.getByText("5s")).toBeInTheDocument();
  });

  it("should render completed tasks section", () => {
    const completedTasks = [makeTask({ id: "c1", content: "Done task", status: "completed", completedAt: Date.now() })];
    render(<TaskQueue {...defaultProps} completedTasks={completedTasks} />);
    expect(screen.getByText(/已完成 \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("Done task")).toBeInTheDocument();
  });

  it("should render failed tasks section", () => {
    const failedTasks = [makeTask({ id: "f1", content: "Failed task", status: "failed", errorMessage: "Error occurred" })];
    render(<TaskQueue {...defaultProps} failedTasks={failedTasks} />);
    expect(screen.getByText(/出错了 \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("Error occurred")).toBeInTheDocument();
  });

  it("should show user/AI label based on task type", () => {
    const queue = [makeTask({ id: "t1", type: "user_defined", content: "User task" })];
    render(<TaskQueue {...defaultProps} queue={queue} />);
    expect(screen.getByText("用户")).toBeInTheDocument();
  });

  it("should hide priority in simpleMode", () => {
    const queue = [makeTask({ id: "t1", content: "Simple" })];
    const { container } = render(<TaskQueue {...defaultProps} queue={queue} simpleMode={true} />);
    expect(container.textContent).not.toContain("P5");
  });

  it("should show priority when not simpleMode", () => {
    const queue = [makeTask({ id: "t1", content: "Normal" })];
    render(<TaskQueue {...defaultProps} queue={queue} simpleMode={false} />);
    expect(screen.getByText("P5")).toBeInTheDocument();
  });
});
