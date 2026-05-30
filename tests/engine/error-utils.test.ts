import { describe, it, expect } from "vitest";
import { isRetryableError } from "../../src-engine/src/lib/error-utils.js";

describe("isRetryableError", () => {
  it("detects connection reset", () => {
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
  });

  it("detects timeout errors", () => {
    expect(isRetryableError(new Error("request timeout"))).toBe(true);
    expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
  });

  it("detects rate limiting (429)", () => {
    expect(isRetryableError(new Error("HTTP 429 Too Many Requests"))).toBe(true);
  });

  it("detects server errors (502/503/504)", () => {
    expect(isRetryableError(new Error("502 Bad Gateway"))).toBe(true);
    expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isRetryableError(new Error("504 Gateway Timeout"))).toBe(true);
  });

  it("detects overloaded errors", () => {
    expect(isRetryableError(new Error("server is overloaded"))).toBe(true);
  });

  it("does not match permanent errors", () => {
    expect(isRetryableError(new Error("Invalid request"))).toBe(false);
    expect(isRetryableError(new Error("Unauthorized"))).toBe(false);
    expect(isRetryableError(new Error("Not found"))).toBe(false);
  });

  it("handles string errors", () => {
    expect(isRetryableError("network error")).toBe(true);
    expect(isRetryableError("something else")).toBe(false);
  });
});
