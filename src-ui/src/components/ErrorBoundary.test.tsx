import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/test-utils";
import { ErrorBoundary } from "./ErrorBoundary";

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Test error message");
  return <div>OK</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    renderWithProviders(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("renders error UI when child throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("出错了")).toBeInTheDocument();
    expect(screen.getByText("Test error message")).toBeInTheDocument();
    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("shows error details toggle when stack exists", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithProviders(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("查看详情")).toBeInTheDocument();

    await userEvent.click(screen.getByText("查看详情"));
    expect(screen.getByText("收起")).toBeInTheDocument();

    await userEvent.click(screen.getByText("收起"));
    expect(screen.getByText("查看详情")).toBeInTheDocument();
  });

  it("recovers on retry click", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;

    function ControlledChild() {
      if (shouldThrow) throw new Error("Recoverable error");
      return <div>Recovered</div>;
    }

    renderWithProviders(
      <ErrorBoundary>
        <ControlledChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText("出错了")).toBeInTheDocument();

    shouldThrow = false;
    await userEvent.click(screen.getByText("重试"));
    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });
});
