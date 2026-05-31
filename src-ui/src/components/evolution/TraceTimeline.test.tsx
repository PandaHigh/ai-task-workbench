import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TraceTimeline } from "./TraceTimeline";
import type { TraceSpan } from "@ai-workbench/shared";

vi.mock("../../lib/utils", () => ({
  formatDuration: (ms: number) => `${ms}ms`,
}));

const makeSpan = (overrides: Partial<TraceSpan> = {}): TraceSpan => ({
  traceId: "trace-001",
  spanId: "span-001",
  operation: "planner.plan",
  startTime: Date.now() - 5000,
  endTime: Date.now() - 1000,
  durationMs: 4000,
  status: "ok",
  attributes: {},
  ...overrides,
});

describe("TraceTimeline", () => {
  it("should show empty state when no spans", () => {
    render(<TraceTimeline spans={[]} />);
    expect(screen.getByText("暂无追踪数据")).toBeInTheDocument();
  });

  it("should render span count", () => {
    render(<TraceTimeline spans={[makeSpan()]} />);
    expect(screen.getByText(/1 spans/)).toBeInTheDocument();
  });

  it("should render operation names", () => {
    render(<TraceTimeline spans={[makeSpan({ operation: "planner.plan" })]} />);
    expect(screen.getByText("planner.plan")).toBeInTheDocument();
  });

  it("should render duration", () => {
    render(<TraceTimeline spans={[makeSpan({ durationMs: 4000 })]} />);
    expect(screen.getByText("4000ms")).toBeInTheDocument();
  });

  it("should show OK status for ok spans", () => {
    render(<TraceTimeline spans={[makeSpan({ status: "ok" })]} />);
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("should show ERR status for error spans", () => {
    render(<TraceTimeline spans={[makeSpan({ status: "error" })]} />);
    expect(screen.getByText("ERR")).toBeInTheDocument();
  });

  it("should show running indicator", () => {
    render(<TraceTimeline spans={[makeSpan({ status: "running", endTime: undefined })]} />);
    expect(screen.getByText("...")).toBeInTheDocument();
  });

  it("should expand span details on click", () => {
    render(<TraceTimeline spans={[makeSpan({ spanId: "span-abc123456" })]} />);
    const button = screen.getByRole("button");
    expect(screen.queryByText("Span:")).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByText("Span:")).toBeInTheDocument();
    expect(screen.getByText("span-abc")).toBeInTheDocument();
  });

  it("should collapse span on second click", () => {
    render(<TraceTimeline spans={[makeSpan()]} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(screen.getByText("Span:")).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByText("Span:")).not.toBeInTheDocument();
  });

  it("should render attributes JSON when non-empty", () => {
    render(<TraceTimeline spans={[makeSpan({ attributes: { key: "value" } })]} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/"key"/)).toBeInTheDocument();
  });

  it("should render multiple spans sorted by startTime", () => {
    const spans = [
      makeSpan({ spanId: "s2", operation: "tester.test", startTime: Date.now() - 2000 }),
      makeSpan({ spanId: "s1", operation: "planner.plan", startTime: Date.now() - 5000 }),
    ];
    render(<TraceTimeline spans={spans} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("planner.plan");
    expect(buttons[1]).toHaveTextContent("tester.test");
  });
});
