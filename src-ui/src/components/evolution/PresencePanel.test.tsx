import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const mockCall = vi.fn();

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ call: mockCall, connected: true }),
}));

import { PresencePanel } from "./PresencePanel";

describe("PresencePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockResolvedValue({ sessions: [] });
  });

  it("should return null when no sessions", async () => {
    mockCall.mockResolvedValue({ sessions: [] });
    const { container } = render(<PresencePanel />);
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });

  it("should return null when only one session", async () => {
    mockCall.mockResolvedValue({ sessions: [{ sessionId: "s1", displayName: "User", role: "owner" }] });
    const { container } = render(<PresencePanel />);
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });

  it("should render session list when 2+ sessions", async () => {
    mockCall.mockResolvedValue({
      sessions: [
        { sessionId: "s1", displayName: "Owner", role: "owner" },
        { sessionId: "s2", displayName: "Collab", role: "collaborator" },
      ],
    });
    render(<PresencePanel />);
    await act(async () => {});
    expect(screen.getByText("在线用户")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Collab")).toBeInTheDocument();
  });

  it("should display role badges", async () => {
    mockCall.mockResolvedValue({
      sessions: [
        { sessionId: "s1", displayName: "A", role: "owner" },
        { sessionId: "s2", displayName: "B", role: "collaborator" },
      ],
    });
    render(<PresencePanel />);
    await act(async () => {});
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.getByText("collaborator")).toBeInTheDocument();
  });

  it("should handle load failure gracefully", async () => {
    mockCall.mockRejectedValue(new Error("fail"));
    const { container } = render(<PresencePanel />);
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });
});
