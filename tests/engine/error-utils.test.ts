import { describe, it, expect } from "vitest";
import { errorToMessage, classifyError, getRetryStrategy, TaskError } from "../../src-engine/src/lib/error-utils.js";

// ─── errorToMessage ───────────────────────────────────────────────────────

describe("errorToMessage", () => {
  it("returns err.message for Error instances", () => {
    expect(errorToMessage(new Error("something went wrong"))).toBe("something went wrong");
  });

  it("returns String(err) for non-Error values", () => {
    expect(errorToMessage({ msg: "fail" } as unknown)).toBe("[object Object]");
  });

  it("handles null", () => {
    expect(errorToMessage(null)).toBe("null");
  });

  it("handles undefined", () => {
    expect(errorToMessage(undefined)).toBe("undefined");
  });

  it("handles numbers", () => {
    expect(errorToMessage(42)).toBe("42");
  });

  it("handles strings", () => {
    expect(errorToMessage("plain string error")).toBe("plain string error");
  });

  it("handles boolean false", () => {
    expect(errorToMessage(false)).toBe("false");
  });
});

// ─── classifyError (re-export) ────────────────────────────────────────────

describe("classifyError", () => {
  it("passes through existing TaskError unchanged", () => {
    const original = new TaskError("test", "rate_limited", { retryable: true });
    const result = classifyError(original);
    expect(result).toBe(original);
    expect(result.category).toBe("rate_limited");
  });

  it("classifies transient errors", () => {
    const result = classifyError(new Error("ECONNRESET"));
    expect(result.category).toBe("transient");
  });

  it("classifies rate limited errors", () => {
    const result = classifyError(new Error("HTTP 429"));
    expect(result.category).toBe("rate_limited");
    expect(result.retryable).toBe(true);
  });

  it("classifies permanent errors", () => {
    const result = classifyError(new Error("Unknown issue"));
    expect(result.category).toBe("permanent");
  });
});

// ─── getRetryStrategy (re-export) ─────────────────────────────────────────

describe("getRetryStrategy", () => {
  it("returns a defensive copy for transient", () => {
    const a = getRetryStrategy("transient");
    const b = getRetryStrategy("transient");
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // different object references
  });

  it("transient strategy allows retry with backoff", () => {
    const s = getRetryStrategy("transient");
    expect(s.shouldRetry).toBe(true);
    expect(s.backoffMs).toBeGreaterThan(0);
    expect(s.maxRetries).toBe(3);
  });

  it("permanent strategy has no retry", () => {
    const s = getRetryStrategy("permanent");
    expect(s.shouldRetry).toBe(false);
    expect(s.maxRetries).toBe(0);
  });

  it("rate_limited strategy pauses the run", () => {
    const s = getRetryStrategy("rate_limited");
    expect(s.shouldRetry).toBe(true);
    expect(s.pauseRunMs).toBeGreaterThan(0);
  });
});
