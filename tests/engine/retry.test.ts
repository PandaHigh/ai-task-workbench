import { describe, it, expect, vi } from "vitest";
import { retryWithBackoff } from "../../src-engine/src/lib/retry.js";

describe("retryWithBackoff", () => {
  it("returns result on first success", async () => {
    const result = await retryWithBackoff(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });

  it("retries on failure and succeeds", async () => {
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt++;
      if (attempt < 3) throw new Error("fail");
      return "ok";
    });
    const result = await retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after max attempts", async () => {
    const fn = vi.fn(async () => {
      throw new Error("always fail");
    });
    await expect(retryWithBackoff(fn, { maxAttempts: 2, initialDelayMs: 10 })).rejects.toThrow("always fail");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("skips retry when shouldRetry returns false", async () => {
    const fn = vi.fn(async () => {
      throw new Error("permanent");
    });
    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 5,
        initialDelayMs: 10,
        shouldRetry: (err) => !(err instanceof Error && err.message === "permanent"),
      }),
    ).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects maxDelayMs cap", async () => {
    const start = Date.now();
    let attempt = 0;
    await retryWithBackoff(
      async () => {
        attempt++;
        if (attempt < 3) throw new Error("retry");
        return "ok";
      },
      { maxAttempts: 3, initialDelayMs: 50, maxDelayMs: 60, backoffFactor: 10 },
    );
    const elapsed = Date.now() - start;
    // initial: 50ms, second: min(50*10, 60)=60ms, total ~110ms max
    expect(elapsed).toBeLessThan(200);
  });
});
