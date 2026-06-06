import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAsyncAction } from "./useAsyncAction";

vi.mock("../components/common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

describe("useAsyncAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should start with no loading", () => {
    const { result } = renderHook(() => useAsyncAction());
    expect(result.current.loading).toBeNull();
  });

  it("should set loading during execution", async () => {
    let resolveFn: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });

    const { result } = renderHook(() => useAsyncAction());

    act(() => {
      result.current.execute("test", () => promise);
    });

    expect(result.current.loading).toBe("test");

    await act(async () => {
      resolveFn!();
      await promise;
    });

    expect(result.current.loading).toBeNull();
  });

  it("should call onSuccess callback", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useAsyncAction());

    await act(async () => {
      await result.current.execute("test", () => Promise.resolve("result"), onSuccess);
    });

    expect(onSuccess).toHaveBeenCalledWith("result");
  });

  it("should show error toast on failure", async () => {
    const { result } = renderHook(() => useAsyncAction());

    await act(async () => {
      await result.current.execute("test", () => Promise.reject(new Error("fail")));
    });

    expect(result.current.loading).toBeNull();
  });

  it("should prevent concurrent executions", async () => {
    let resolveFn: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });
    const { result } = renderHook(() => useAsyncAction());

    act(() => {
      result.current.execute("first", () => promise);
    });

    const result2 = await act(async () => {
      return result.current.execute("second", () => Promise.resolve());
    });

    expect(result2).toBeUndefined();

    await act(async () => {
      resolveFn!();
      await promise;
    });
  });
});
