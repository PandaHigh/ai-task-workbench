import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const mockCall = vi.fn();

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ call: mockCall, connected: true }),
}));

vi.mock("../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("../../lib/platform", () => ({
  ENGINE_HTTP_URL: "http://localhost:9731",
}));

import { SkillsManager } from "./SkillsManager";

describe("SkillsManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockResolvedValue([]);
  });

  it("should show empty states when no skills", async () => {
    mockCall.mockResolvedValue([]);
    await act(async () => {
      render(<SkillsManager />);
    });
    expect(screen.getByText("暂无内置 skills")).toBeInTheDocument();
    expect(screen.getByText("暂无自定义 skills")).toBeInTheDocument();
  });

  it("should display skill names", async () => {
    mockCall.mockResolvedValue([
      {
        name: "Code Review",
        description: "Review code",
        type: "builtin",
        dirName: "code-review",
        createdAt: "2026-01-01",
        fileCount: 3,
      },
    ]);
    await act(async () => {
      render(<SkillsManager />);
    });
    expect(screen.getByText("Code Review")).toBeInTheDocument();
  });

  it("should show upload button", async () => {
    mockCall.mockResolvedValue([]);
    await act(async () => {
      render(<SkillsManager />);
    });
    expect(screen.getAllByText(/上传/).length).toBeGreaterThanOrEqual(1);
  });

  it("should call skill.list on mount", async () => {
    await act(async () => {
      render(<SkillsManager />);
    });
    expect(mockCall).toHaveBeenCalledWith("skill.list", {});
  });
});
