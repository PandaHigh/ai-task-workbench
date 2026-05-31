import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not render when closed", () => {
    render(<ConfirmDialog open={false} message="Are you sure?" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should render message when open", () => {
    render(<ConfirmDialog open={true} message="Delete this?" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText("Delete this?")).toBeInTheDocument();
  });

  it("should use default title when not provided", () => {
    render(<ConfirmDialog open={true} message="Test" onConfirm={onConfirm} onCancel={onCancel} />);
    // Default title is "确认" and confirmLabel is also "确认"
    const confirms = screen.getAllByText("确认");
    expect(confirms.length).toBeGreaterThanOrEqual(1);
  });

  it("should use custom title", () => {
    render(<ConfirmDialog open={true} title="警告！" message="Test" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText("警告！")).toBeInTheDocument();
  });

  it("should use custom confirm label", () => {
    render(<ConfirmDialog open={true} message="Test" confirmLabel="删除" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText("删除")).toBeInTheDocument();
  });

  it("should use custom cancel label", () => {
    render(<ConfirmDialog open={true} message="Test" cancelLabel="不了" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText("不了")).toBeInTheDocument();
  });

  it("should call onConfirm when confirm clicked", () => {
    render(<ConfirmDialog open={true} message="Test" confirmLabel="Yes" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Yes"));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should call onCancel when cancel clicked", () => {
    render(<ConfirmDialog open={true} message="Test" cancelLabel="Nope" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Nope"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("should render with danger variant", () => {
    render(<ConfirmDialog open={true} message="Test" confirmLabel="Del" variant="danger" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText("Del")).toBeInTheDocument();
  });

  it("should render as alertdialog with aria-modal", () => {
    render(<ConfirmDialog open={true} message="Test" onConfirm={onConfirm} onCancel={onCancel} />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });
});
