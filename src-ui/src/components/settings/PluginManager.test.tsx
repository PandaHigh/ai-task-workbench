import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const mockCall = vi.fn();

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ call: mockCall, connected: true }),
}));

vi.mock("../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { PluginManager } from "./PluginManager";

describe("PluginManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockResolvedValue([]);
  });

  it("should show empty state when no plugins", async () => {
    mockCall.mockResolvedValue([]);
    await act(async () => {
      render(<PluginManager />);
    });
    expect(screen.getByText("暂无 MCP Server 插件")).toBeInTheDocument();
  });

  it("should display plugin names", async () => {
    mockCall.mockResolvedValue([
      {
        id: "p1",
        name: "filesystem",
        description: "File system MCP",
        type: "mcp-server",
        config: { name: "filesystem", command: "npx", args: ["-y", "@mcp/server"] },
        status: "stopped",
        enabled: false,
      },
    ]);
    await act(async () => {
      render(<PluginManager />);
    });
    expect(screen.getByText("filesystem")).toBeInTheDocument();
  });

  it("should call plugin.list on mount", async () => {
    await act(async () => {
      render(<PluginManager />);
    });
    expect(mockCall).toHaveBeenCalledWith("plugin.list", {});
  });
});
