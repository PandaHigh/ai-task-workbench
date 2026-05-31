import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddTaskModal } from "./AddTaskModal";

describe("AddTaskModal", () => {
  const mockOnClose = vi.fn();
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not render when closed", () => {
    render(<AddTaskModal open={false} onClose={mockOnClose} onSubmit={mockOnSubmit} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should render when open", () => {
    render(<AddTaskModal open={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("添加任务")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("描述你的任务...")).toBeInTheDocument();
  });

  it("should call onClose when clicking backdrop", () => {
    render(<AddTaskModal open={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />);
    const backdrop = screen.getByRole("dialog");
    fireEvent.click(backdrop);
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("should call onClose when clicking cancel", () => {
    render(<AddTaskModal open={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />);
    fireEvent.click(screen.getByText("取消"));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("should disable submit button when text is empty", () => {
    render(<AddTaskModal open={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />);
    expect(screen.getByText("确认添加")).toBeDisabled();
  });

  it("should enable submit button when text is entered", () => {
    render(<AddTaskModal open={true} onClose={mockOnClose} onSubmit={mockOnSubmit} />);
    const textarea = screen.getByPlaceholderText("描述你的任务...");
    fireEvent.change(textarea, { target: { value: "New task" } });
    expect(screen.getByText("确认添加")).not.toBeDisabled();
  });

  it("should call onSubmit with text, priority, and timeout", () => {
    render(<AddTaskModal open={true} onClose={mockOnClose} onSubmit={mockOnSubmit} defaultPriority={3} defaultTimeout={120} />);
    const textarea = screen.getByPlaceholderText("描述你的任务...");
    fireEvent.change(textarea, { target: { value: "Fix the bug" } });
    fireEvent.click(screen.getByText("确认添加"));
    expect(mockOnSubmit).toHaveBeenCalledWith("Fix the bug", 3, 120, { condition: undefined, dependsOn: undefined });
  });
});
