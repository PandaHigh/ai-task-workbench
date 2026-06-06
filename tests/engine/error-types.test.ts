import { describe, it, expect } from "vitest";
import {
  classifyError,
  getRetryStrategy,
  TaskError,
  type ErrorCategory,
} from "../../src-engine/src/lib/error-types.js";

describe("classifyError", () => {
  it("passes through existing TaskError", () => {
    const original = new TaskError("test", "rate_limited", { retryable: true });
    const result = classifyError(original);
    expect(result).toBe(original);
    expect(result.category).toBe("rate_limited");
  });

  // ─── quota_exceeded ──────────────────────────────────────────────
  it("classifies quota exceeded", () => {
    expect(classifyError(new Error("usage limit reached")).category).toBe("quota_exceeded");
    expect(classifyError(new Error("quota exceeded")).category).toBe("quota_exceeded");
    expect(classifyError(new Error("billing hard limit")).category).toBe("quota_exceeded");
  });

  // ─── rate_limited ────────────────────────────────────────────────
  it("classifies rate limiting", () => {
    const e1 = classifyError(new Error("HTTP 429 Too Many Requests"));
    expect(e1.category).toBe("rate_limited");
    expect(e1.retryable).toBe(true);

    expect(classifyError(new Error("rate limit exceeded")).category).toBe("rate_limited");
    expect(classifyError(new Error("server is overloaded")).category).toBe("rate_limited");
    expect(classifyError(new Error("capacity exceeded")).category).toBe("rate_limited");
  });

  // ─── task_timeout ────────────────────────────────────────────────
  it("classifies timeouts", () => {
    const e = classifyError(new Error("Task timed out after 10 minutes"));
    expect(e.category).toBe("task_timeout");
    expect(e.retryable).toBe(true);
  });

  // ─── pipeline_failure ────────────────────────────────────────────
  it("classifies pipeline phase failures with phase name", () => {
    const planner = classifyError(new Error("Planner phase failed: could not parse"));
    expect(planner.category).toBe("pipeline_failure");
    expect(planner.phase).toBe("planner");
    expect(planner.retryable).toBe(true);

    const developer = classifyError(new Error("Developer phase failed after 3 iterations: crash"));
    expect(developer.category).toBe("pipeline_failure");
    expect(developer.phase).toBe("developer");

    const tester = classifyError(new Error("Tester phase failed: no output"));
    expect(tester.phase).toBe("tester");

    const reviewer = classifyError(new Error("Reviewer phase failed: timeout"));
    expect(reviewer.phase).toBe("reviewer");
  });

  // ─── transient ──────────────────────────────────────────────────
  it("classifies transient network errors", () => {
    expect(classifyError(new Error("ECONNRESET")).category).toBe("transient");
    expect(classifyError(new Error("ECONNREFUSED")).category).toBe("transient");
    expect(classifyError(new Error("ETIMEDOUT")).category).toBe("transient");
    expect(classifyError(new Error("socket hang up")).category).toBe("transient");
    expect(classifyError(new Error("fetch failed")).category).toBe("transient");
    expect(classifyError(new Error("ENOENT: no such file")).category).toBe("transient");
  });

  // ─── task_failure ───────────────────────────────────────────────
  it("classifies task failures", () => {
    expect(classifyError(new Error("CC process exited with code 1")).category).toBe("task_failure");
    expect(classifyError(new Error("SIGTERM received")).category).toBe("task_failure");
    expect(classifyError(new Error("Task was aborted")).category).toBe("task_failure");
  });

  // ─── permanent ──────────────────────────────────────────────────
  it("classifies unknown errors as permanent", () => {
    expect(classifyError(new Error("Invalid request")).category).toBe("permanent");
    expect(classifyError(new Error("Unauthorized")).category).toBe("permanent");
    expect(classifyError(new Error("Something completely unexpected")).category).toBe("permanent");
  });

  it("handles string errors", () => {
    expect(classifyError("ECONNRESET").category).toBe("transient");
    expect(classifyError("something random").category).toBe("permanent");
  });

  it("preserves cause", () => {
    const cause = new Error("original");
    const result = classifyError(cause);
    expect(result.cause).toBe(cause);
  });
});

describe("getRetryStrategy", () => {
  it("transient: retry with backoff", () => {
    const s = getRetryStrategy("transient");
    expect(s.shouldRetry).toBe(true);
    expect(s.backoffMs).toBeGreaterThan(0);
    expect(s.pauseRunMs).toBe(0);
    expect(s.maxRetries).toBe(3);
  });

  it("rate_limited: retry with run pause", () => {
    const s = getRetryStrategy("rate_limited");
    expect(s.shouldRetry).toBe(true);
    expect(s.pauseRunMs).toBeGreaterThan(0);
    expect(s.maxRetries).toBe(3);
  });

  it("quota_exceeded: no retry", () => {
    const s = getRetryStrategy("quota_exceeded");
    expect(s.shouldRetry).toBe(false);
    expect(s.maxRetries).toBe(0);
  });

  it("task_timeout: retry max 2", () => {
    const s = getRetryStrategy("task_timeout");
    expect(s.shouldRetry).toBe(true);
    expect(s.maxRetries).toBe(2);
  });

  it("pipeline_failure: retry max 1", () => {
    const s = getRetryStrategy("pipeline_failure");
    expect(s.shouldRetry).toBe(true);
    expect(s.maxRetries).toBe(1);
  });

  it("permanent: no retry", () => {
    const s = getRetryStrategy("permanent");
    expect(s.shouldRetry).toBe(false);
    expect(s.maxRetries).toBe(0);
  });

  it("task_failure: no retry", () => {
    const s = getRetryStrategy("task_failure");
    expect(s.shouldRetry).toBe(false);
    expect(s.maxRetries).toBe(0);
  });
});

describe("TaskError", () => {
  it("carries category, phase, retryable, cause", () => {
    const cause = new Error("root cause");
    const err = new TaskError("msg", "pipeline_failure", {
      phase: "developer",
      retryable: true,
      cause,
    });
    expect(err.message).toBe("msg");
    expect(err.name).toBe("TaskError");
    expect(err.category).toBe("pipeline_failure");
    expect(err.phase).toBe("developer");
    expect(err.retryable).toBe(true);
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TaskError);
  });

  it("defaults retryable to false", () => {
    const err = new TaskError("msg", "permanent");
    expect(err.retryable).toBe(false);
    expect(err.phase).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });
});
