import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/test-utils";

const mockCall = vi.fn();

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ connected: true, call: mockCall }),
}));

import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockImplementation(async ({ key }: { key: string }) => {
      const defaults: Record<string, unknown> = {
        qualityThreshold: { value: 0.6 },
        defaultTimeout: { value: 60 },
        claudePath: { value: "claude" },
      };
      return defaults[key] ?? null;
    });
  });

  it("renders settings title", async () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText("设置")).toBeInTheDocument();
  });

  it("shows loading skeleton before loaded", () => {
    mockCall.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<SettingsPage />);
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0);
  });

  it("loads and displays config values", async () => {
    renderWithProviders(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("已连接 (ws://localhost:9731)")).toBeInTheDocument();
    });
    expect(screen.getByText("保存设置")).toBeInTheDocument();
  });

  it("saves settings on button click", async () => {
    renderWithProviders(<SettingsPage />);
    await waitFor(() => screen.getByText("保存设置"));
    await userEvent.click(screen.getByText("保存设置"));
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("config.set", expect.objectContaining({ key: "qualityThreshold" }));
    });
  });

  it("shows disconnected when engine is offline", async () => {
    vi.doMock("../../hooks/useEngine", () => ({
      useEngine: () => ({ connected: false, call: vi.fn() }),
    }));
  });
});
