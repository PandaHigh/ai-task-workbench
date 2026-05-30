import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardErrorBoundary } from "./DashboardErrorBoundary";

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Test error");
  return <div>Normal content</div>;
}

describe("DashboardErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("should render children when no error", () => {
    render(
      <DashboardErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </DashboardErrorBoundary>
    );
    expect(screen.getByText("Normal content")).toBeInTheDocument();
  });

  it("should show error message when child throws", () => {
    render(
      <DashboardErrorBoundary name="测试组件">
        <ThrowingComponent shouldThrow={true} />
      </DashboardErrorBoundary>
    );
    expect(screen.getByText("测试组件 加载出错")).toBeInTheDocument();
    expect(screen.getByText("Test error")).toBeInTheDocument();
  });

  it("should show retry button", () => {
    render(
      <DashboardErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </DashboardErrorBoundary>
    );
    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("should show generic error message when no name", () => {
    render(
      <DashboardErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </DashboardErrorBoundary>
    );
    expect(screen.getByText("加载出错")).toBeInTheDocument();
  });
});
