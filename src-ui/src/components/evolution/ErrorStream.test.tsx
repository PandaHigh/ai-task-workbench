import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ErrorStream } from "./ErrorStream";
import { useEvolutionStore } from "../../stores/evolution-store";

const mockCall = vi.fn();

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ connected: true, call: mockCall }),
}));

describe("ErrorStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEvolutionStore.getState().reset();
  });

  it("should show loading state initially", () => {
    mockCall.mockReturnValue(new Promise(() => {}));
    render(<ErrorStream runId="r1" />);
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("should display errors loaded from RPC", async () => {
    mockCall.mockResolvedValueOnce([
      { id: "e1", message: "Runtime error", severity: "critical", category: "runtime", runId: "r1", timestamp: 1000 },
      { id: "e2", message: "Type error", severity: "warning", category: "type", runId: "r1", timestamp: 2000 },
    ]);

    render(<ErrorStream runId="r1" />);

    await waitFor(() => {
      expect(screen.getByText("错误记录 (2)")).toBeInTheDocument();
    });
    expect(screen.getByText(/Runtime error/)).toBeInTheDocument();
    expect(screen.getByText("严重")).toBeInTheDocument();
    expect(screen.getByText("警告")).toBeInTheDocument();
  });

  it("should show empty state when no errors", async () => {
    mockCall.mockResolvedValueOnce([]);

    render(<ErrorStream runId="r1" />);

    await waitFor(() => {
      expect(screen.getByText("暂无错误记录")).toBeInTheDocument();
    });
  });

  it("should update when store receives new error", async () => {
    mockCall.mockResolvedValueOnce([]);

    render(<ErrorStream runId="r1" />);

    await waitFor(() => {
      expect(screen.getByText("暂无错误记录")).toBeInTheDocument();
    });

    useEvolutionStore.getState().addError({
      id: "e3", message: "New error", severity: "critical", category: "runtime", runId: "r1", timestamp: 3000,
    });

    await waitFor(() => {
      expect(screen.getByText("错误记录 (1)")).toBeInTheDocument();
    });
  });
});
