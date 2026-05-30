import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SharePanel } from "./SharePanel";

const mockCall = vi.fn();

vi.mock("../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

describe("SharePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not render when closed", () => {
    render(<SharePanel open={false} onClose={() => {}} runId="r1" call={mockCall} />);
    expect(screen.queryByText("分享管理")).not.toBeInTheDocument();
  });

  it("should render when open", () => {
    mockCall.mockResolvedValueOnce([]);
    render(<SharePanel open={true} onClose={() => {}} runId="r1" call={mockCall} />);
    expect(screen.getByText("分享管理")).toBeInTheDocument();
    expect(screen.getByText("创建链接")).toBeInTheDocument();
  });

  it("should load and display tokens", async () => {
    const tokens = [
      { token: "abc-123", runId: "r1", label: "张三", createdAt: Date.now() - 100_000, expiresAt: null },
      { token: "def-456", runId: "r1", label: "", createdAt: Date.now() - 200_000, expiresAt: Date.now() + 3600_000 },
    ];
    mockCall.mockResolvedValueOnce(tokens);

    render(<SharePanel open={true} onClose={() => {}} runId="r1" call={mockCall} />);

    await waitFor(() => {
      expect(screen.getByText("已有链接 (2)")).toBeInTheDocument();
    });
    expect(screen.getByText("张三")).toBeInTheDocument();
  });

  it("should show empty state when no tokens", async () => {
    mockCall.mockResolvedValueOnce([]);

    render(<SharePanel open={true} onClose={() => {}} runId="r1" call={mockCall} />);

    await waitFor(() => {
      expect(screen.getByText("还没有分享链接")).toBeInTheDocument();
    });
  });

  it("should create a new share link", async () => {
    mockCall.mockResolvedValueOnce([]);
    mockCall.mockResolvedValueOnce({ token: "new-token", url: "http://localhost:1420/#/share/new-token", createdAt: Date.now() });
    mockCall.mockResolvedValueOnce([]);

    render(<SharePanel open={true} onClose={() => {}} runId="r1" call={mockCall} />);

    await waitFor(() => {
      expect(screen.getByText("创建链接")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("创建链接"));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("share.create", expect.objectContaining({ runId: "r1" }));
    });
  });

  it("should create with label and expiry", async () => {
    mockCall.mockResolvedValueOnce([]);
    mockCall.mockResolvedValueOnce({ token: "t1", url: "http://localhost/#/share/t1", createdAt: Date.now() });
    mockCall.mockResolvedValueOnce([]);

    render(<SharePanel open={true} onClose={() => {}} runId="r1" call={mockCall} />);

    await waitFor(() => {
      expect(screen.getByText("创建链接")).toBeInTheDocument();
    });

    const labelInput = screen.getByPlaceholderText(/标签/);
    fireEvent.change(labelInput, { target: { value: "测试标签" } });

    fireEvent.click(screen.getByText("1 天"));

    fireEvent.click(screen.getByText("创建链接"));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("share.create", expect.objectContaining({
        runId: "r1",
        label: "测试标签",
        expiresAt: expect.any(Number),
      }));
    });
  });

  it("should revoke a token", async () => {
    const tokens = [
      { token: "abc-123", runId: "r1", label: "", createdAt: Date.now(), expiresAt: null },
    ];
    mockCall.mockResolvedValueOnce(tokens);
    mockCall.mockResolvedValueOnce({ revoked: true });
    mockCall.mockResolvedValueOnce([]);

    render(<SharePanel open={true} onClose={() => {}} runId="r1" call={mockCall} />);

    await waitFor(() => {
      expect(screen.getByText("撤销")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("撤销"));

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith("share.revoke", { token: "abc-123" });
    });
  });

  it("should close when clicking backdrop", () => {
    const onClose = vi.fn();
    mockCall.mockResolvedValueOnce([]);

    const { container } = render(<SharePanel open={true} onClose={onClose} runId="r1" call={mockCall} />);

    // The backdrop is the first child div (fixed overlay)
    const backdrop = container.firstElementChild as HTMLElement;
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it("should close when clicking close button", () => {
    const onClose = vi.fn();
    mockCall.mockResolvedValueOnce([]);

    render(<SharePanel open={true} onClose={onClose} runId="r1" call={mockCall} />);

    fireEvent.click(screen.getByText("关闭"));

    expect(onClose).toHaveBeenCalled();
  });
});
