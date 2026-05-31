import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const mockCall = vi.fn();
const mockSetSuggestions = vi.fn();
const mockSuggestions: unknown[] = [];

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ call: mockCall, connected: true }),
}));

vi.mock("../../stores/evolution-store", () => ({
  useEvolutionStore: (selector: (s: { suggestions: unknown[]; setSuggestions: typeof mockSetSuggestions }) => unknown) =>
    selector({ suggestions: mockSuggestions, setSuggestions: mockSetSuggestions }),
}));

import { ReviewSuggestions } from "./ReviewSuggestions";

describe("ReviewSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockResolvedValue([]);
    mockSuggestions.length = 0;
  });

  it("should show loading state initially", () => {
    mockCall.mockReturnValue(new Promise(() => {}));
    render(<ReviewSuggestions runId="run-1" />);
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("should show empty state when no suggestions", async () => {
    mockCall.mockResolvedValue([]);
    await act(async () => { render(<ReviewSuggestions runId="run-1" />); });
    expect(screen.getByText("暂无审查建议")).toBeInTheDocument();
  });

  it("should call suggestion.list on mount", async () => {
    await act(async () => { render(<ReviewSuggestions runId="run-1" />); });
    expect(mockCall).toHaveBeenCalledWith("suggestion.list", { runId: "run-1" });
  });

  it("should display suggestion summary", async () => {
    const suggestions = [
      { id: "s1", score: 0.8, summary: "Code looks good", status: "reviewed", issues: [] },
    ];
    mockCall.mockResolvedValue(suggestions);
    mockSuggestions.push(...suggestions);
    await act(async () => { render(<ReviewSuggestions runId="run-1" />); });
    expect(screen.getByText("Code looks good")).toBeInTheDocument();
  });

  it("should show score badge", async () => {
    const suggestions = [
      { id: "s1", score: 0.8, summary: "Good", status: "reviewed", issues: [] },
    ];
    mockCall.mockResolvedValue(suggestions);
    mockSuggestions.push(...suggestions);
    await act(async () => { render(<ReviewSuggestions runId="run-1" />); });
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("should show fix_created badge", async () => {
    const suggestions = [
      { id: "s1", score: 0.5, summary: "Issues found", status: "fix_created", issues: [] },
    ];
    mockCall.mockResolvedValue(suggestions);
    mockSuggestions.push(...suggestions);
    await act(async () => { render(<ReviewSuggestions runId="run-1" />); });
    expect(screen.getByText("已创建修复")).toBeInTheDocument();
  });

  it("should display issues with severity", async () => {
    const suggestions = [
      {
        id: "s1", score: 0.4, summary: "Bad code", status: "reviewed",
        issues: [{ severity: "critical", file: "src/main.ts", line: 42, description: "Memory leak" }],
      },
    ];
    mockCall.mockResolvedValue(suggestions);
    mockSuggestions.push(...suggestions);
    await act(async () => { render(<ReviewSuggestions runId="run-1" />); });
    expect(screen.getByText("严重")).toBeInTheDocument();
    expect(screen.getByText(/src\/main\.ts:42/)).toBeInTheDocument();
    expect(screen.getByText("Memory leak")).toBeInTheDocument();
  });

  it("should handle load failure gracefully", async () => {
    mockCall.mockRejectedValue(new Error("Network error"));
    await act(async () => { render(<ReviewSuggestions runId="run-1" />); });
    expect(screen.getByText("暂无审查建议")).toBeInTheDocument();
  });
});
