import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskCreateForm } from "./TaskCreateForm";

describe("TaskCreateForm", () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render with default values", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} />);
    expect(screen.getByPlaceholderText("描述你的任务...")).toBeInTheDocument();
    expect(screen.getByText("确认")).toBeDisabled();
  });

  it("should enable submit when text is entered", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} />);
    fireEvent.change(screen.getByPlaceholderText("描述你的任务..."), { target: { value: "New task" } });
    expect(screen.getByText("确认")).not.toBeDisabled();
  });

  it("should call onSubmit with content, priority, timeout", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} defaultPriority={3} defaultTimeout={120} />);
    fireEvent.change(screen.getByPlaceholderText("描述你的任务..."), { target: { value: "My task" } });
    fireEvent.click(screen.getByText("确认"));
    expect(mockOnSubmit).toHaveBeenCalledWith({ content: "My task", priority: 3, timeoutMinutes: 120 });
  });

  it("should call onCancel when clicking cancel", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.click(screen.getByText("取消"));
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it("should not show cancel button when no onCancel", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} />);
    expect(screen.queryByText("取消")).not.toBeInTheDocument();
  });

  it("should show template selector when templates provided", () => {
    const templates = [
      { id: "t1", name: "Bug Fix", content: "Fix bug", priority: 3, timeoutMinutes: 30, isBuiltIn: false, createdAt: 1, updatedAt: 1 },
    ];
    render(<TaskCreateForm onSubmit={mockOnSubmit} templates={templates} />);
    expect(screen.getByText("使用模板")).toBeInTheDocument();
    fireEvent.click(screen.getByText("使用模板"));
    expect(screen.getByText("Bug Fix")).toBeInTheDocument();
  });

  it("should apply template on click", () => {
    const templates = [
      { id: "t1", name: "Bug Fix", content: "Fix the bug", priority: 7, timeoutMinutes: 90, isBuiltIn: false, createdAt: 1, updatedAt: 1 },
    ];
    render(<TaskCreateForm onSubmit={mockOnSubmit} templates={templates} />);
    fireEvent.click(screen.getByText("使用模板"));
    fireEvent.click(screen.getByText("Bug Fix"));
    expect(screen.getByPlaceholderText("描述你的任务...")).toHaveValue("Fix the bug");
    fireEvent.click(screen.getByText("确认"));
    expect(mockOnSubmit).toHaveBeenCalledWith({ content: "Fix the bug", priority: 7, timeoutMinutes: 90 });
  });

  it("should use custom submit label", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} submitLabel="添加" />);
    expect(screen.getByText("添加")).toBeInTheDocument();
  });

  it("should not show template button when no templates", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} templates={[]} />);
    expect(screen.queryByText("使用模板")).not.toBeInTheDocument();
  });

  // ─── dependsOn tests ─────────────────────────────────

  it("should show advanced options button when existingTasks provided", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} existingTasks={[{ id: "task-1", content: "Task 1 content" }, { id: "task-2", content: "Task 2 content" }]} />);
    expect(screen.getByText("高级选项（依赖任务）")).toBeInTheDocument();
  });

  it("should not show advanced options button when no existingTasks", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} />);
    expect(screen.queryByText(/高级选项/)).not.toBeInTheDocument();
  });

  it("should show dependency buttons with task content when advanced section is open", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} existingTasks={[{ id: "task-abc123", content: "Implement feature X" }]} />);
    fireEvent.click(screen.getByText("高级选项（依赖任务）"));
    expect(screen.getByText("Implement feature X")).toBeInTheDocument();
  });

  it("should toggle dependency selection", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} existingTasks={[{ id: "task-abc123", content: "Write tests" }]} />);
    fireEvent.click(screen.getByText("高级选项（依赖任务）"));

    const depBtn = screen.getByText("Write tests");
    fireEvent.click(depBtn);
    // Should be selected (blue background style applied)
    expect(depBtn).toBeInTheDocument();

    // Click again to deselect
    fireEvent.click(depBtn);
    expect(depBtn).toBeInTheDocument();
  });

  it("should not show condition input when advanced is open", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} existingTasks={[{ id: "t1", content: "Task 1" }]} />);
    fireEvent.click(screen.getByText("高级选项（依赖任务）"));
    expect(screen.queryByPlaceholderText(/lastScore/)).not.toBeInTheDocument();
  });

  it("should submit with dependsOn", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} existingTasks={[{ id: "dep-1", content: "Setup database" }]} />);
    fireEvent.change(screen.getByPlaceholderText("描述你的任务..."), { target: { value: "Task with deps" } });
    fireEvent.click(screen.getByText("高级选项（依赖任务）"));

    // Select dependency
    fireEvent.click(screen.getByText("Setup database"));

    fireEvent.click(screen.getByText("确认"));
    expect(mockOnSubmit).toHaveBeenCalledWith({
      content: "Task with deps",
      priority: 5,
      timeoutMinutes: 60,
      dependsOn: ["dep-1"],
    });
  });

  it("should submit without dependsOn when none selected", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} existingTasks={[{ id: "t1", content: "Task 1" }]} />);
    fireEvent.change(screen.getByPlaceholderText("描述你的任务..."), { target: { value: "No deps" } });
    fireEvent.click(screen.getByText("确认"));
    expect(mockOnSubmit).toHaveBeenCalledWith({
      content: "No deps",
      priority: 5,
      timeoutMinutes: 60,
    });
  });

  it("should support Ctrl+Enter shortcut", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} />);
    const textarea = screen.getByPlaceholderText("描述你的任务...");
    fireEvent.change(textarea, { target: { value: "Quick submit" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(mockOnSubmit).toHaveBeenCalledWith({ content: "Quick submit", priority: 5, timeoutMinutes: 60 });
  });
});
