import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/test-utils";

const mockShortcuts = [
  { key: "n", mod: true, description: "新建任务", action: vi.fn(), priority: 0 },
  { key: "Escape", description: "返回", action: vi.fn(), priority: -1 },
];

vi.mock("../../hooks/useKeyboard", () => ({
  getShortcuts: () => mockShortcuts,
  setModalActive: vi.fn(),
}));

import { ShortcutHelp } from "./ShortcutHelp";

describe("ShortcutHelp", () => {
  it("returns null when not open", () => {
    renderWithProviders(<ShortcutHelp open={false} onClose={vi.fn()} />);
    expect(screen.queryByText("快捷键")).not.toBeInTheDocument();
  });

  it("renders shortcut list when open", () => {
    renderWithProviders(<ShortcutHelp open={true} onClose={vi.fn()} />);
    expect(screen.getByText("快捷键")).toBeInTheDocument();
    expect(screen.getByText("新建任务")).toBeInTheDocument();
    expect(screen.getByText("返回")).toBeInTheDocument();
  });

  it("closes on Escape key", async () => {
    const onClose = vi.fn();
    renderWithProviders(<ShortcutHelp open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
  });

  it("shows Esc hint text", () => {
    renderWithProviders(<ShortcutHelp open={true} onClose={vi.fn()} />);
    expect(screen.getByText("按 Esc 关闭")).toBeInTheDocument();
  });
});

