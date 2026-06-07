import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

  it("should render tool_use messages with content string", () => {
    const map = new Map([["t1", [{ type: "tool_use", content: "Read file" }]]]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText("Read file")).toBeInTheDocument();
  });

  it("should render tool_use messages with name and input", () => {
    const map = new Map([
      [
        "t1",
        [
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: "/src/index.ts" },
          },
        ],
      ],
    ]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText(/file_path: \/src\/index\.ts/)).toBeInTheDocument();
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
    const map = new Map([
      ["t1", [{ type: "result", subtype: "success", duration_ms: 5000, total_cost_usd: 0.05, num_turns: 3 }]],
    ]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText(/OK/)).toBeInTheDocument();
    expect(screen.getByText(/5\.0s/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.0500/)).toBeInTheDocument();
    expect(screen.getByText(/3 turns/)).toBeInTheDocument();
  });

  it("should render error result", () => {
    const map = new Map([["t1", [{ type: "result", error: "Something went wrong" }]]]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText(/ERR/)).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("should render system messages", () => {
    const map = new Map([["t1", [{ type: "system", content: "System init" }]]]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText(/SYS/)).toBeInTheDocument();
    expect(screen.getByText("System init")).toBeInTheDocument();
  });

  it("should handle array content blocks", () => {
    const map = new Map([["t1", [{ type: "assistant", content: [{ text: "Block 1" }, { text: "Block 2" }] }]]]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText(/Block 1/)).toBeInTheDocument();
  });

  // ─── New tests for thinking blocks ─────────────────────────────────────

  it("should render thinking blocks from assistant content with collapse toggle", () => {
    const map = new Map([
      [
        "t1",
        [
          {
            type: "assistant",
            content: [
              { type: "thinking", thinking: "Let me analyze this code step by step" },
              { type: "text", text: "Here is the result" },
            ],
          },
        ],
      ],
    ]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    // Thinking preview should be visible
    expect(screen.getByText(/思考过程/)).toBeInTheDocument();
    // Text content should also be rendered
    expect(screen.getByText("Here is the result")).toBeInTheDocument();
  });

  it("should expand thinking blocks on click", async () => {
    const user = userEvent.setup();
    const longThinking = "A".repeat(200);
    const map = new Map([
      [
        "t1",
        [
          {
            type: "assistant",
            content: [{ type: "thinking", thinking: longThinking }],
          },
        ],
      ],
    ]);
    mockGet.mockReturnValue(map);
    const { container } = render(<StreamingOutput taskId="t1" />);

    // Click to expand
    const button = screen.getByText(/思考过程/);
    await user.click(button);

    // Full thinking text should be visible
    const thinkingDiv = container.querySelector("[style*='border-left']");
    expect(thinkingDiv).toBeInTheDocument();
  });

  it("should handle redacted thinking blocks", () => {
    const map = new Map([
      [
        "t1",
        [
          {
            type: "assistant",
            content: [
              { type: "redacted_thinking" },
              { type: "text", text: "Final answer" },
            ],
          },
        ],
      ],
    ]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText(/思考过程/)).toBeInTheDocument();
    // Text content is joined with the redacted marker in the same <pre>
    expect(screen.getByText(/Final answer/)).toBeInTheDocument();
  });

  it("should return null for unknown message types", () => {
    const map = new Map([["t1", [{ type: "unknown_type", content: "something" }]]]);
    mockGet.mockReturnValue(map);
    const { container } = render(<StreamingOutput taskId="t1" />);
    // No message bubbles should be rendered
    const bubbles = container.querySelectorAll("pre");
    expect(bubbles.length).toBe(0);
  });

  it("should handle tool_use with array content including tool_use blocks", () => {
    const map = new Map([
      [
        "t1",
        [
          {
            type: "tool_use",
            content: [{ type: "tool_use", name: "Edit", input: { file_path: "/a.ts" } }],
          },
        ],
      ],
    ]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    // Should render something for the tool_use
    expect(screen.getByText(/TOOL/)).toBeInTheDocument();
  });

  it("should handle tool_result with array content blocks", () => {
    const map = new Map([
      [
        "t1",
        [
          {
            type: "tool_result",
            content: [{ type: "text", text: "output line 1" }, { type: "text", text: "output line 2" }],
          },
        ],
      ],
    ]);
    mockGet.mockReturnValue(map);
    render(<StreamingOutput taskId="t1" />);
    expect(screen.getByText(/output line 1/)).toBeInTheDocument();
  });
});
