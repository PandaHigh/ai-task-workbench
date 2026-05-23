import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRegisterShortcut, useKeyboard, setModalActive, setToggleHelp, getShortcuts } from "./useKeyboard";
import type { ShortcutDef } from "./useKeyboard";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

describe("useKeyboard", () => {
  beforeEach(() => {
    setModalActive(false);
    setToggleHelp(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("setModalActive / setToggleHelp / getShortcuts", () => {
    it("setModalActive sets modal state", () => {
      setModalActive(true);
      // No crash = success (internal state)
      setModalActive(false);
    });

    it("setToggleHelp sets toggle function", () => {
      const fn = vi.fn();
      setToggleHelp(fn);
      setToggleHelp(null);
    });

    it("getShortcuts returns a copy of the registry", () => {
      const shortcuts = getShortcuts();
      expect(Array.isArray(shortcuts)).toBe(true);
    });
  });

  describe("useRegisterShortcut", () => {
    it("registers a shortcut and cleans up on unmount", () => {
      const def: ShortcutDef = {
        key: "k",
        mod: true,
        description: "Test shortcut",
        action: vi.fn(),
      };

      const before = getShortcuts().length;
      const { unmount } = renderHook(() => useRegisterShortcut(def));

      expect(getShortcuts().length).toBe(before + 1);

      unmount();

      expect(getShortcuts().length).toBe(before);
    });
  });

  describe("useKeyboard", () => {
    it("registers default shortcuts and cleans up on unmount", () => {
      const before = getShortcuts().length;
      const { unmount } = renderHook(() => useKeyboard());

      const afterMount = getShortcuts().length;
      expect(afterMount).toBeGreaterThan(before);

      unmount();

      expect(getShortcuts().length).toBe(before);
    });
  });
});
