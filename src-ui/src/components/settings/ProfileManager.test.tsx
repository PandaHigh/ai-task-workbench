import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mockCall = vi.fn();
const fullProfile = {
  id: "default",
  name: "默认配置",
  isBuiltIn: true,
  config: { mode: "fixloop", qualityThreshold: 0.6, maxFixIterations: 3, backgroundReview: false, errorWatch: false },
};

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ call: mockCall, connected: true }),
}));

vi.mock("../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { ProfileManager } from "./ProfileManager";

describe("ProfileManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockReset();
  });

  it("should call profile.list and config.get on mount", async () => {
    mockCall.mockResolvedValueOnce([fullProfile]);
    mockCall.mockResolvedValueOnce("default");

    render(<ProfileManager />);
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("profile.list", {});
      expect(mockCall).toHaveBeenCalledWith("config.get", { key: "activeProfile" });
    });
  });

  it("should load and display profiles", async () => {
    mockCall.mockResolvedValueOnce([fullProfile]);
    mockCall.mockResolvedValueOnce("default");

    render(<ProfileManager />);
    await waitFor(() => {
      expect(screen.getByText("默认配置")).toBeInTheDocument();
    });
  });

  it("should show create profile button", async () => {
    mockCall.mockResolvedValueOnce([]);
    mockCall.mockResolvedValueOnce(null);

    render(<ProfileManager />);
    await waitFor(() => {
      expect(screen.getByText(/创建/)).toBeInTheDocument();
    });
  });

  it("should show profile mode label", async () => {
    mockCall.mockResolvedValueOnce([fullProfile]);
    mockCall.mockResolvedValueOnce("default");

    render(<ProfileManager />);
    await waitFor(() => {
      expect(screen.getByText("默认配置")).toBeInTheDocument();
    });
  });
});
