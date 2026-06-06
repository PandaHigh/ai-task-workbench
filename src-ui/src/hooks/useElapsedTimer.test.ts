import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useElapsedTimer } from "./useElapsedTimer";

describe("useElapsedTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return empty string when no startTimestamp", () => {
    const { result } = renderHook(() => useElapsedTimer(null));
    expect(result.current).toBe("");
  });

  it("should return empty string when startTimestamp is undefined", () => {
    const { result } = renderHook(() => useElapsedTimer(undefined));
    expect(result.current).toBe("");
  });

  it("should return elapsed time string for valid timestamp", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const start = now - 30_000; // 30 seconds ago
    const { result } = renderHook(() => useElapsedTimer(start));
    expect(result.current).toBe("30s");
  });

  it("should update over time", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const start = now - 30_000;
    const { result } = renderHook(() => useElapsedTimer(start));
    expect(result.current).toBe("30s");

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe("40s");
  });

  it("should show minutes when >= 60s", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const start = now - 90_000; // 1m 30s ago
    const { result } = renderHook(() => useElapsedTimer(start));
    expect(result.current).toBe("1m 30s");
  });

  it("should cleanup interval on unmount", () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const { unmount } = renderHook(() => useElapsedTimer(now - 1000));
    unmount();
    // Should not throw
  });
});
