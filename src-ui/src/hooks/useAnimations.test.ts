import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  pageEnterStyle,
  staggerItemStyle,
  shimmerStyle,
  typewriterStyle,
  pulseStyle,
  useAnimationStyle,
  useStagger,
  useTypewriter,
} from "./useAnimations";

describe("animation style utilities", () => {
  it("pageEnterStyle returns fadeIn animation", () => {
    expect(pageEnterStyle()).toEqual({ animation: "fadeIn 0.4s ease-out" });
  });

  it("staggerItemStyle returns animation with index-based delay", () => {
    const style = staggerItemStyle(3, 100);
    expect(style.animation).toContain("slideUp");
    expect(style.animation).toContain("0.4s");
    expect(style.animation).toContain("300ms");
  });

  it("staggerItemStyle accepts custom name and duration", () => {
    const style = staggerItemStyle(0, 50, "fadeIn", 0.6);
    expect(style.animation).toContain("fadeIn");
    expect(style.animation).toContain("0.6s");
  });

  it("shimmerStyle returns shimmer animation", () => {
    const style = shimmerStyle();
    expect(style.animation).toContain("shimmer");
    expect(style.backgroundSize).toBe("200% 100%");
  });

  it("typewriterStyle returns typewriter animation with default duration", () => {
    const style = typewriterStyle();
    expect(style.animation).toContain("typewriter");
    expect(style.animation).toContain("2s");
  });

  it("typewriterStyle accepts custom duration", () => {
    const style = typewriterStyle(3);
    expect(style.animation).toContain("3s");
  });

  it("pulseStyle returns pulse animation", () => {
    expect(pulseStyle().animation).toContain("pulse");
  });
});

describe("useAnimationStyle", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it("returns fadeIn animation by default", () => {
    const { result } = renderHook(() => useAnimationStyle());
    expect(result.current.animation).toContain("fadeIn");
  });

  it("returns custom animation name", () => {
    const { result } = renderHook(() => useAnimationStyle({ name: "slideUp" }));
    expect(result.current.animation).toContain("slideUp");
  });

  it("returns empty object when disabled", () => {
    const { result } = renderHook(() => useAnimationStyle({ disabled: true }));
    expect(result.current).toEqual({});
  });

  it("returns custom duration and delay", () => {
    const { result } = renderHook(() => useAnimationStyle({ duration: 0.8, delay: 100 }));
    expect(result.current.animation).toContain("0.8s");
    expect(result.current.animation).toContain("100ms");
  });
});

describe("useStagger", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it("returns a style generator function", () => {
    const { result } = renderHook(() => useStagger());
    expect(typeof result.current).toBe("function");
  });

  it("generates staggered animation for index", () => {
    const { result } = renderHook(() => useStagger(50));
    const style = result.current(2);
    expect(style.animation).toContain("slideUp");
    expect(style.animation).toContain("100ms");
  });

  it("accepts custom name and duration", () => {
    const { result } = renderHook(() => useStagger(30, "fadeIn", 0.5));
    const style = result.current(1);
    expect(style.animation).toContain("fadeIn");
    expect(style.animation).toContain("0.5s");
    expect(style.animation).toContain("30ms");
  });
});

describe("useTypewriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with empty string", () => {
    const { result } = renderHook(() => useTypewriter("hello"));
    expect(result.current.displayed).toBe("");
  });

  it("reveals characters over time", () => {
    const { result } = renderHook(() => useTypewriter("hi", 10));
    act(() => { vi.advanceTimersByTime(10); });
    expect(result.current.displayed).toBe("h");
    act(() => { vi.advanceTimersByTime(10); });
    expect(result.current.displayed).toBe("hi");
  });

  it("reset clears displayed text", () => {
    const { result } = renderHook(() => useTypewriter("hi", 10));
    act(() => { vi.advanceTimersByTime(30); });
    expect(result.current.displayed).toBe("hi");
    act(() => { result.current.reset(); });
    expect(result.current.displayed).toBe("");
  });
});
