import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <span data-href={to}>{children}</span>
  ),
}));

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => ({ connected: true, call: vi.fn() }),
}));

vi.mock("../../hooks/useTheme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

vi.mock("../../hooks/useDesktopEngine", () => ({
  useDesktopEngine: () => ({ isDesktop: false, restartEngine: vi.fn() }),
}));

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("should render navigation labels", () => {
    render(<Sidebar />);
    expect(screen.getByText("首页")).toBeInTheDocument();
    expect(screen.getByText("创建任务")).toBeInTheDocument();
    expect(screen.getByText("设置")).toBeInTheDocument();
  });

  it("should render navigation elements", () => {
    const { container } = render(<Sidebar />);
    // Navigation labels exist even if wrapped differently
    expect(container.textContent).toContain("首页");
    expect(container.textContent).toContain("创建任务");
    expect(container.textContent).toContain("设置");
  });

  it("should render theme toggle button", () => {
    const { container } = render(<Sidebar />);
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});
