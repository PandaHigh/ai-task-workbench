import { describe, it, expect } from "vitest";
import { errorToMessage, classifyError, getRetryStrategy, TaskError } from "../../src-engine/src/lib/error-utils.js";
import type { ErrorCategory, RetryStrategy } from "../../src-engine/src/lib/error-utils.js";

// ─── errorToMessage ───────────────────────────────────────────────────────

describe("errorToMessage", () => {
  it("returns err.message for Error instances", () => {
    expect(errorToMessage(new Error("something went wrong"))).toBe("something went wrong");
  });

  it("returns err.message for subclassed Error (TypeError)", () => {
    expect(errorToMessage(new TypeError("not a function"))).toBe("not a function");
  });

  it("returns err.message for RangeError", () => {
    expect(errorToMessage(new RangeError("out of range"))).toBe("out of range");
  });

  it("returns err.message for SyntaxError", () => {
    expect(errorToMessage(new SyntaxError("unexpected token"))).toBe("unexpected token");
  });

  it("returns String(err) for non-Error values (plain object)", () => {
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

  it("handles zero", () => {
    expect(errorToMessage(0)).toBe("0");
  });

  it("handles negative numbers", () => {
    expect(errorToMessage(-1)).toBe("-1");
  });

  it("handles strings", () => {
    expect(errorToMessage("plain string error")).toBe("plain string error");
  });

  it("handles empty string", () => {
    expect(errorToMessage("")).toBe("");
  });

  it("handles boolean false", () => {
    expect(errorToMessage(false)).toBe("false");
  });

  it("handles boolean true", () => {
    expect(errorToMessage(true)).toBe("true");
  });

  it("handles arrays", () => {
    expect(errorToMessage([1, 2, 3] as unknown)).toBe("1,2,3");
  });

  it("handles empty array", () => {
    expect(errorToMessage([] as unknown)).toBe("");
  });

  it("handles Error with empty message", () => {
    expect(errorToMessage(new Error(""))).toBe("");
  });
});

// ─── TaskError class ──────────────────────────────────────────────────────

describe("TaskError", () => {
  it("sets name to 'TaskError'", () => {
    const err = new TaskError("test", "permanent");
    expect(err.name).toBe("TaskError");
  });

  it("sets message from constructor", () => {
    const err = new TaskError("boom", "transient");
    expect(err.message).toBe("boom");
  });

  it("sets category from constructor", () => {
    const err = new TaskError("test", "rate_limited");
    expect(err.category).toBe("rate_limited");
  });

  it("defaults retryable to false", () => {
    const err = new TaskError("test", "permanent");
    expect(err.retryable).toBe(false);
  });

  it("sets retryable from opts", () => {
    const err = new TaskError("test", "transient", { retryable: true });
    expect(err.retryable).toBe(true);
  });

  it("defaults phase to undefined", () => {
    const err = new TaskError("test", "permanent");
    expect(err.phase).toBeUndefined();
  });

  it("sets phase from opts", () => {
    const err = new TaskError("test", "pipeline_failure", { phase: "reviewer" });
    expect(err.phase).toBe("reviewer");
  });

  it("defaults cause to undefined", () => {
    const err = new TaskError("test", "permanent");
    expect(err.cause).toBeUndefined();
  });

  it("sets cause from opts", () => {
    const cause = new Error("root cause");
    const err = new TaskError("test", "permanent", { cause });
    expect(err.cause).toBe(cause);
  });

  it("is an instance of Error", () => {
    const err = new TaskError("test", "permanent");
    expect(err).toBeInstanceOf(Error);
  });

  it("is an instance of TaskError", () => {
    const err = new TaskError("test", "permanent");
    expect(err).toBeInstanceOf(TaskError);
  });

  it("can be caught with try/catch", () => {
    let caught: TaskError | undefined;
    try {
      throw new TaskError("boom", "task_failure");
    } catch (e) {
      if (e instanceof TaskError) caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught!.category).toBe("task_failure");
  });
});

// ─── classifyError (re-export) ────────────────────────────────────────────

describe("classifyError", () => {
  // ── Pass-through ──

  it("passes through existing TaskError unchanged", () => {
    const original = new TaskError("test", "rate_limited", { retryable: true });
    const result = classifyError(original);
    expect(result).toBe(original);
    expect(result.category).toBe("rate_limited");
  });

  // ── Transient patterns ──

  it("classifies ECONNRESET as transient", () => {
    expect(classifyError(new Error("ECONNRESET")).category).toBe("transient");
  });

  it("classifies ECONNREFUSED as transient", () => {
    expect(classifyError(new Error("ECONNREFUSED")).category).toBe("transient");
  });

  it("classifies ETIMEDOUT as transient", () => {
    expect(classifyError(new Error("ETIMEDOUT")).category).toBe("transient");
  });

  it("classifies 'socket hang up' as transient", () => {
    expect(classifyError(new Error("socket hang up")).category).toBe("transient");
  });

  it("classifies 'fetch failed' as transient", () => {
    expect(classifyError(new Error("fetch failed")).category).toBe("transient");
  });

  it("classifies ECONNABORTED as transient", () => {
    expect(classifyError(new Error("ECONNABORTED")).category).toBe("transient");
  });

  it("classifies ENOENT as transient", () => {
    expect(classifyError(new Error("ENOENT")).category).toBe("transient");
  });

  it("marks transient as retryable", () => {
    expect(classifyError(new Error("ECONNRESET")).retryable).toBe(true);
  });

  // ── Rate limit patterns ──

  it("classifies 'HTTP 429' as rate_limited", () => {
    expect(classifyError(new Error("HTTP 429")).category).toBe("rate_limited");
  });

  it("classifies 'Rate limit exceeded' as rate_limited", () => {
    expect(classifyError(new Error("Rate limit exceeded")).category).toBe("rate_limited");
  });

  it("classifies 'overloaded' as rate_limited", () => {
    expect(classifyError(new Error("Server is overloaded")).category).toBe("rate_limited");
  });

  it("classifies 'capacity' as rate_limited", () => {
    expect(classifyError(new Error("At capacity right now")).category).toBe("rate_limited");
  });

  it("classifies 'too many requests' as rate_limited", () => {
    expect(classifyError(new Error("too many requests")).category).toBe("rate_limited");
  });

  it("marks rate_limited as retryable", () => {
    expect(classifyError(new Error("HTTP 429")).retryable).toBe(true);
  });

  // ── Quota exceeded patterns ──

  it("classifies 'usage limit' as quota_exceeded", () => {
    expect(classifyError(new Error("usage limit reached")).category).toBe("quota_exceeded");
  });

  it("classifies 'quota exceeded' as quota_exceeded", () => {
    expect(classifyError(new Error("quota exceeded")).category).toBe("quota_exceeded");
  });

  it("classifies 'billing' as quota_exceeded", () => {
    expect(classifyError(new Error("billing error")).category).toBe("quota_exceeded");
  });

  it("marks quota_exceeded as not retryable", () => {
    expect(classifyError(new Error("usage limit reached")).retryable).toBe(false);
  });

  // ── Pipeline failure patterns ──

  it("classifies 'planner phase failed' as pipeline_failure with phase 'planner'", () => {
    const result = classifyError(new Error("planner phase failed"));
    expect(result.category).toBe("pipeline_failure");
    expect(result.phase).toBe("planner");
  });

  it("classifies 'developer phase failed' as pipeline_failure with phase 'developer'", () => {
    const result = classifyError(new Error("developer phase failed"));
    expect(result.category).toBe("pipeline_failure");
    expect(result.phase).toBe("developer");
  });

  it("classifies 'tester phase failed' as pipeline_failure with phase 'tester'", () => {
    const result = classifyError(new Error("tester phase failed"));
    expect(result.category).toBe("pipeline_failure");
    expect(result.phase).toBe("tester");
  });

  it("classifies 'reviewer phase failed' as pipeline_failure with phase 'reviewer'", () => {
    const result = classifyError(new Error("reviewer phase failed"));
    expect(result.category).toBe("pipeline_failure");
    expect(result.phase).toBe("reviewer");
  });

  it("marks pipeline_failure as retryable", () => {
    expect(classifyError(new Error("planner phase failed")).retryable).toBe(true);
  });

  // ── Timeout patterns ──

  it("classifies 'timed out' as task_timeout", () => {
    expect(classifyError(new Error("Operation timed out")).category).toBe("task_timeout");
  });

  it("classifies 'timeout' as task_timeout", () => {
    expect(classifyError(new Error("Connection timeout")).category).toBe("task_timeout");
  });

  it("marks task_timeout as retryable", () => {
    expect(classifyError(new Error("timed out")).retryable).toBe(true);
  });

  // ── Task failure patterns ──

  it("classifies 'exited with code' as task_failure", () => {
    expect(classifyError(new Error("Process exited with code 1")).category).toBe("task_failure");
  });

  it("classifies 'SIGTERM' as task_failure", () => {
    expect(classifyError(new Error("Received SIGTERM")).category).toBe("task_failure");
  });

  it("classifies 'SIGKILL' as task_failure", () => {
    expect(classifyError(new Error("Received SIGKILL")).category).toBe("task_failure");
  });

  it("classifies 'aborted' as task_failure", () => {
    expect(classifyError(new Error("Operation was aborted")).category).toBe("task_failure");
  });

  it("marks task_failure as not retryable", () => {
    expect(classifyError(new Error("exited with code 1")).retryable).toBe(false);
  });

  // ── Permanent (fallback) ──

  it("classifies unknown errors as permanent", () => {
    const result = classifyError(new Error("Unknown issue"));
    expect(result.category).toBe("permanent");
  });

  it("marks permanent as not retryable", () => {
    expect(classifyError(new Error("something completely unexpected")).retryable).toBe(false);
  });

  // ── Priority / ordering edge cases ──

  it("quota_exceeded takes priority over rate_limited", () => {
    // "billing" matches quota; also "rate limit" would match rate_limited but quota is checked first
    const result = classifyError(new Error("billing rate limit"));
    expect(result.category).toBe("quota_exceeded");
  });

  it("pipeline_failure is detected before timeout", () => {
    // "reviewer phase failed: timeout" should be pipeline_failure, not task_timeout
    const result = classifyError(new Error("reviewer phase failed: timeout"));
    expect(result.category).toBe("pipeline_failure");
    expect(result.phase).toBe("reviewer");
  });

  // ── Non-Error inputs ──

  it("classifies string input as permanent", () => {
    const result = classifyError("something broke");
    expect(result.category).toBe("permanent");
    expect(result.message).toBe("something broke");
  });

  it("classifies number input as permanent", () => {
    const result = classifyError(500);
    expect(result.category).toBe("permanent");
    expect(result.message).toBe("500");
  });

  it("classifies null as permanent", () => {
    const result = classifyError(null);
    expect(result.category).toBe("permanent");
    expect(result.message).toBe("null");
  });

  it("classifies undefined as permanent", () => {
    const result = classifyError(undefined);
    expect(result.category).toBe("permanent");
    expect(result.message).toBe("undefined");
  });

  it("preserves cause for Error inputs", () => {
    const original = new Error("ECONNRESET");
    const result = classifyError(original);
    expect(result.cause).toBe(original);
  });

  it("wraps non-Error input in a new cause Error", () => {
    const result = classifyError("plain string");
    expect(result.cause).toBeInstanceOf(Error);
    expect(result.cause!.message).toBe("plain string");
  });

  // ── Case insensitivity ──

  it("pattern matching is case-insensitive for transient (econnreset)", () => {
    expect(classifyError(new Error("econnreset")).category).toBe("transient");
  });

  it("pattern matching is case-insensitive for rate limit (RATE LIMIT)", () => {
    expect(classifyError(new Error("RATE LIMIT")).category).toBe("rate_limited");
  });

  it("pipeline phase matching is case-insensitive (Planner Phase Failed)", () => {
    const result = classifyError(new Error("Planner Phase Failed"));
    expect(result.category).toBe("pipeline_failure");
    expect(result.phase).toBe("planner");
  });
});

// ─── getRetryStrategy (re-export) ─────────────────────────────────────────

describe("getRetryStrategy", () => {
  // ── Defensive copies ──

  it("returns a defensive copy for transient", () => {
    const a = getRetryStrategy("transient");
    const b = getRetryStrategy("transient");
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // different object references
  });

  // ── Transient ──

  it("transient strategy allows retry with backoff", () => {
    const s = getRetryStrategy("transient");
    expect(s.shouldRetry).toBe(true);
    expect(s.backoffMs).toBeGreaterThan(0);
    expect(s.pauseRunMs).toBe(0);
    expect(s.maxRetries).toBe(3);
  });

  // ── Rate limited ──

  it("rate_limited strategy pauses the run", () => {
    const s = getRetryStrategy("rate_limited");
    expect(s.shouldRetry).toBe(true);
    expect(s.backoffMs).toBe(0);
    expect(s.pauseRunMs).toBeGreaterThan(0);
    expect(s.maxRetries).toBe(3);
  });

  // ── Quota exceeded ──

  it("quota_exceeded strategy has no retry", () => {
    const s = getRetryStrategy("quota_exceeded");
    expect(s.shouldRetry).toBe(false);
    expect(s.backoffMs).toBe(0);
    expect(s.pauseRunMs).toBe(0);
    expect(s.maxRetries).toBe(0);
  });

  // ── Task timeout ──

  it("task_timeout strategy allows retry with backoff", () => {
    const s = getRetryStrategy("task_timeout");
    expect(s.shouldRetry).toBe(true);
    expect(s.backoffMs).toBeGreaterThan(0);
    expect(s.pauseRunMs).toBe(0);
    expect(s.maxRetries).toBe(2);
  });

  // ── Task failure ──

  it("task_failure strategy has no retry", () => {
    const s = getRetryStrategy("task_failure");
    expect(s.shouldRetry).toBe(false);
    expect(s.backoffMs).toBe(0);
    expect(s.pauseRunMs).toBe(0);
    expect(s.maxRetries).toBe(0);
  });

  // ── Pipeline failure ──

  it("pipeline_failure strategy allows retry with backoff", () => {
    const s = getRetryStrategy("pipeline_failure");
    expect(s.shouldRetry).toBe(true);
    expect(s.backoffMs).toBeGreaterThan(0);
    expect(s.pauseRunMs).toBe(0);
    expect(s.maxRetries).toBe(1);
  });

  // ── Permanent ──

  it("permanent strategy has no retry", () => {
    const s = getRetryStrategy("permanent");
    expect(s.shouldRetry).toBe(false);
    expect(s.backoffMs).toBe(0);
    expect(s.pauseRunMs).toBe(0);
    expect(s.maxRetries).toBe(0);
  });

  // ── All categories covered ──

  const ALL_CATEGORIES: ErrorCategory[] = [
    "transient",
    "rate_limited",
    "quota_exceeded",
    "task_timeout",
    "task_failure",
    "pipeline_failure",
    "permanent",
  ];

  it("every category returns a valid RetryStrategy object", () => {
    for (const cat of ALL_CATEGORIES) {
      const s = getRetryStrategy(cat);
      expect(typeof s.shouldRetry).toBe("boolean");
      expect(typeof s.backoffMs).toBe("number");
      expect(typeof s.pauseRunMs).toBe("number");
      expect(typeof s.maxRetries).toBe("number");
      expect(s.backoffMs).toBeGreaterThanOrEqual(0);
      expect(s.pauseRunMs).toBeGreaterThanOrEqual(0);
      expect(s.maxRetries).toBeGreaterThanOrEqual(0);
    }
  });

  it("every strategy has consistent shouldRetry/maxRetries", () => {
    for (const cat of ALL_CATEGORIES) {
      const s = getRetryStrategy(cat);
      if (s.shouldRetry) {
        expect(s.maxRetries).toBeGreaterThan(0);
      } else {
        expect(s.maxRetries).toBe(0);
      }
    }
  });
});
