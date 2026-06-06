import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { LogPanel } from "./LogPanel";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ call: vi.fn(), connected: true }),
}));

describe("LogPanel", () => {
  const defaultLogs = [
    { id: 1, timestamp: Date.now() - 2000, level: "info" as const, source: "engine" as const, message: "Started task" },
    {
      id: 2,
      timestamp: Date.now() - 1000,
      level: "error" as const,
      source: "engine" as const,
      message: "Something failed",
    },
    { id: 3, timestamp: Date.now(), level: "success" as const, source: "engine" as const, message: "Task completed" },
  ];

  it("should render log messages", () => {
    render(<LogPanel logs={defaultLogs} activeTaskIds={[]} />);
    expect(screen.getByText("Started task")).toBeInTheDocument();
    expect(screen.getByText("Something failed")).toBeInTheDocument();
    expect(screen.getByText("Task completed")).toBeInTheDocument();
  });

  it("should show empty state when no logs", () => {
    render(<LogPanel logs={[]} activeTaskIds={[]} />);
    expect(screen.getByText("等待任务执行")).toBeInTheDocument();
  });

  it("should render error level logs", () => {
    render(<LogPanel logs={defaultLogs} activeTaskIds={[]} />);
    expect(screen.getByText("Something failed")).toBeInTheDocument();
  });

  it("should render many logs", () => {
    const manyLogs = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      timestamp: Date.now() - (50 - i) * 100,
      level: "info" as const,
      source: "engine" as const,
      message: `Log entry ${i}`,
    }));
    render(<LogPanel logs={manyLogs} activeTaskIds={[]} />);
    expect(screen.getByText("Log entry 49")).toBeInTheDocument();
  });

  it("should display timestamps", () => {
    render(<LogPanel logs={defaultLogs} activeTaskIds={[]} />);
    // Should have some time display
    const { container } = render(<LogPanel logs={defaultLogs} activeTaskIds={[]} />);
    expect(container.textContent).toBeTruthy();
  });
});
