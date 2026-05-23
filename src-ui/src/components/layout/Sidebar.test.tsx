import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/test-utils";

const mockEngine = { connected: true, call: vi.fn() };

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => mockEngine,
}));

vi.mock("../../hooks/useKeyboard", () => ({
  useKeyboard: () => {},
  setToggleHelp: () => {},
  setModalActive: () => {},
  getShortcuts: () => [],
}));

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("renders nav items", () => {
    renderWithProviders(<Sidebar />);
    expect(screen.getByLabelText("仪表盘")).toBeInTheDocument();
    expect(screen.getByLabelText("新建任务")).toBeInTheDocument();
    expect(screen.getByLabelText("设置")).toBeInTheDocument();
  });

  it("shows engine connected status", () => {
    mockEngine.connected = true;
    renderWithProviders(<Sidebar />);
    expect(screen.getByText("Engine connected")).toBeInTheDocument();
  });

  it("shows engine offline status", () => {
    mockEngine.connected = false;
    renderWithProviders(<Sidebar />);
    expect(screen.getByText("Engine offline")).toBeInTheDocument();
  });

  it("shows app title", () => {
    renderWithProviders(<Sidebar />);
    expect(screen.getByText("AI Task Workbench")).toBeInTheDocument();
  });

  it("shows version", () => {
    renderWithProviders(<Sidebar />);
    expect(screen.getByText("v0.1.0")).toBeInTheDocument();
  });

  it("marks active nav item", () => {
    renderWithProviders(<Sidebar />, { initialEntries: ["/"] });
    const dashboardBtn = screen.getByLabelText("仪表盘");
    expect(dashboardBtn).toHaveAttribute("aria-current", "page");
  });
});
