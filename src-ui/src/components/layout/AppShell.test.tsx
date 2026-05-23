import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/test-utils";

const mockEngine = { connected: true, call: vi.fn() };

vi.mock("../../hooks/useEngine", () => ({
  useEngine: () => mockEngine,
}));

vi.mock("../../hooks/useKeyboard", () => ({
  useKeyboard: () => {},
  setToggleHelp: vi.fn(),
  setModalActive: vi.fn(),
  getShortcuts: () => [],
}));

import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("renders children inside main content area", () => {
    renderWithProviders(
      <AppShell>
        <div>Test Content</div>
      </AppShell>,
    );
    expect(screen.getByText("Test Content")).toBeInTheDocument();
    expect(screen.getByText("跳到主要内容")).toBeInTheDocument();
  });

  it("renders sidebar", () => {
    renderWithProviders(
      <AppShell>
        <div>Content</div>
      </AppShell>,
    );
    expect(screen.getByText("AI Task Workbench")).toBeInTheDocument();
  });
});
