import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("../../stores/approval-store", () => ({
  useApprovalStore: (selector: (s: { streamMessages: Map<string, unknown[]> }) => unknown) =>
    selector({ streamMessages: mockGet() }),
}));

import { StreamingOutput } from "./StreamingOutput";

describe("StreamingOutput", () => {
  it("should show empty state when no messages", () => {
    mockGet.mockReturnValue(new Map());
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText("Waiting for output...")).toBeInTheDocument();
  });

  it("should render assistant messages", () => {
    const map = new Map([["t1", [{ type: "assistant", content: "Hello world" }]]]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("should render user messages", () => {
    const map = new Map([["t1", [{ type: "user", content: "User input" }]]]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText("User input")).toBeInTheDocument();
  });

  it("should render tool_use messages", () => {
    const map = new Map([["t1", [{ type: "tool_use", content: "Read file" }]]]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText("Read file")).toBeInTheDocument();
  });

  it("should render tool_result messages", () => {
    const map = new Map([["t1", [{ type: "tool_result", content: "File content here" }]]]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText("File content here")).toBeInTheDocument();
  });

  it("should truncate long tool_result output", () => {
    const longContent = "x".repeat(600);
    const map = new Map([["t1", [{ type: "tool_result", content: longContent }]]]);
    mockGet.mockReturnValue(map);
    const { container } = render(<StreamingOutput taskId="t1" />);
    const pre = container.querySelector("pre");
    expect(pre?.textContent?.length).toBeLessThan(600);
  });

  it("should render success result", () => {
    const map = new Map([["t1", [{ type: "result", subtype: "success", duration_ms: 5000, total_cost_usd: 0.05, num_turns: 3 }]]]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText(/5\.0s/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.0500/)).toBeInTheDocument();
    expect(screen.getByText(/3 turns/)).toBeInTheDocument();
  });

  it("should render error result", () => {
    const map = new Map([["t1", [{ type: "result", error: "Something went wrong" }]]]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText("ERR")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("should render system messages", () => {
    const map = new Map([["t1", [{ type: "system", content: "System init" }]]]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText("SYS")).toBeInTheDocument();
    expect(screen.getByText("System init")).toBeInTheDocument();
  });

  it("should handle array content blocks", () => {
    const map = new Map([["t1", [{ type: "assistant", content: [{ text: "Block 1" }, { text: "Block 2" }] }]]]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText(/Block 1/)).toBeInTheDocument();
  });
});
