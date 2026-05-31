import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { GitRemotePanel } from "./GitRemotePanel";

const mockCall = vi.fn();

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ call: mockCall, connected: true }),
}));

vi.mock("../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

describe("GitRemotePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockReset();
  });

  it("should show empty state when no remotes", async () => {
    mockCall.mockResolvedValueOnce([]);
    mockCall.mockResolvedValueOnce("main");
    render(<GitRemotePanel />);
    await waitFor(() => {
      expect(screen.getByText("暂无远程仓库配置")).toBeInTheDocument();
    });
  });

  it("should display current branch", async () => {
    mockCall.mockResolvedValueOnce([]);
    mockCall.mockResolvedValueOnce("feature-x");
    render(<GitRemotePanel />);
    await waitFor(() => {
      expect(screen.getByText("feature-x")).toBeInTheDocument();
    });
  });

  it("should list remotes", async () => {
    mockCall.mockResolvedValueOnce([
      { name: "origin", refs: { fetch: "git@github.com:user/repo.git" } },
    ]);
    mockCall.mockResolvedValueOnce("main");
    render(<GitRemotePanel />);
    await waitFor(() => {
      expect(screen.getByText("origin")).toBeInTheDocument();
      expect(screen.getByText("git@github.com:user/repo.git")).toBeInTheDocument();
    });
  });

  it("should show push/pull/fetch buttons", async () => {
    mockCall.mockResolvedValueOnce([]);
    mockCall.mockResolvedValueOnce("main");
    render(<GitRemotePanel />);
    await waitFor(() => {
      expect(screen.getByText("推送")).toBeInTheDocument();
      expect(screen.getByText("拉取")).toBeInTheDocument();
      expect(screen.getByText("Fetch")).toBeInTheDocument();
    });
  });

  it("should show add remote form", async () => {
    mockCall.mockResolvedValueOnce([]);
    mockCall.mockResolvedValueOnce("main");
    render(<GitRemotePanel />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("名称 (如 origin)")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("URL (如 git@github.com:user/repo.git)")).toBeInTheDocument();
    });
  });

  it("should disable push button when branch is empty", async () => {
    mockCall.mockResolvedValueOnce([]);
    mockCall.mockResolvedValueOnce("main");
    render(<GitRemotePanel />);
    await waitFor(() => {
      expect(screen.getByText("推送")).toBeInTheDocument();
    });
    expect(screen.getByText("推送")).toBeDisabled();
  });

  it("should disable add remote when url is empty", async () => {
    mockCall.mockResolvedValueOnce([]);
    mockCall.mockResolvedValueOnce("main");
    render(<GitRemotePanel />);
    await waitFor(() => {
      expect(screen.getByText("添加")).toBeInTheDocument();
    });
    expect(screen.getByText("添加")).toBeDisabled();
  });
});
