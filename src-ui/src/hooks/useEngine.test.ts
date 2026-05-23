import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEngine } from "./useEngine";
import { engineClient } from "../lib/engine-client";

vi.mock("../lib/engine-client", () => ({
  engineClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    call: vi.fn(),
    onNotification: vi.fn().mockReturnValue(() => {}),
  },
}));

describe("useEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts disconnected", () => {
    vi.mocked(engineClient.connect).mockRejectedValue(new Error("no engine"));
    vi.mocked(engineClient.isConnected).mockReturnValue(false);

    const { result } = renderHook(() => useEngine());

    expect(result.current.connected).toBe(false);
  });

  it("connects on mount", async () => {
    vi.mocked(engineClient.connect).mockResolvedValue(undefined);
    vi.mocked(engineClient.isConnected).mockReturnValue(true);

    const { result } = renderHook(() => useEngine());

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });
    expect(engineClient.connect).toHaveBeenCalled();
  });

  it("sets connected=false on connect failure", async () => {
    vi.mocked(engineClient.connect).mockRejectedValue(new Error("fail"));
    vi.mocked(engineClient.isConnected).mockReturnValue(false);

    const { result } = renderHook(() => useEngine());

    await waitFor(() => {
      expect(result.current.connected).toBe(false);
    });
  });

  it("polls connection state every 2 seconds", async () => {
    vi.mocked(engineClient.connect).mockResolvedValue(undefined);
    vi.mocked(engineClient.isConnected).mockReturnValue(true);

    const { result } = renderHook(() => useEngine());

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Simulate disconnect
    vi.mocked(engineClient.isConnected).mockReturnValue(false);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(result.current.connected).toBe(false);
    });
  });

  it("detects reconnection via system.ready notification", async () => {
    let notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null = null;

    vi.mocked(engineClient.onNotification).mockImplementation((handler) => {
      notificationHandler = handler;
      return () => { notificationHandler = null; };
    });
    vi.mocked(engineClient.connect).mockResolvedValue(undefined);
    vi.mocked(engineClient.isConnected).mockReturnValue(true);

    const { result } = renderHook(() => useEngine());

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Simulate disconnect then reconnect notification
    vi.mocked(engineClient.isConnected).mockReturnValue(false);
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(result.current.connected).toBe(false);
    });

    // Fire system.ready notification
    act(() => {
      notificationHandler?.("system.ready", {});
    });

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });
  });

  it("provides call function that delegates to engineClient", async () => {
    vi.mocked(engineClient.connect).mockResolvedValue(undefined);
    vi.mocked(engineClient.isConnected).mockReturnValue(true);
    vi.mocked(engineClient.call).mockResolvedValue({ result: "ok" });

    const { result } = renderHook(() => useEngine());

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    const callResult = await result.current.call("test.method", { key: "value" });
    expect(engineClient.call).toHaveBeenCalledWith("test.method", { key: "value" });
    expect(callResult).toEqual({ result: "ok" });
  });

  it("cleans up on unmount", async () => {
    const unsub = vi.fn();
    vi.mocked(engineClient.connect).mockResolvedValue(undefined);
    vi.mocked(engineClient.isConnected).mockReturnValue(true);
    vi.mocked(engineClient.onNotification).mockReturnValue(unsub);

    const { unmount } = renderHook(() => useEngine());

    await waitFor(() => {
      expect(engineClient.connect).toHaveBeenCalled();
    });

    unmount();

    expect(unsub).toHaveBeenCalled();
  });
});
