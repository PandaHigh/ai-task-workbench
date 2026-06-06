/**
 * Unified error classification for agent scheduling decisions.
 * Replaces the three separate pattern lists (isTransientError, isRetryableError, ERROR_PATTERNS).
 */

export type ErrorCategory =
  | "transient" // Network blip, temp timeout → auto retry with backoff
  | "rate_limited" // API throttle → pause run, cool down
  | "quota_exceeded" // Budget/quota exhausted → stop run
  | "task_timeout" // Single task exceeded timeout → retry or degrade
  | "task_failure" // CC crash, non-zero exit → revert + lesson
  | "pipeline_failure" // Pipeline phase failed → carries phase info
  | "permanent"; // Unrecoverable → mark failed, next task

export class TaskError extends Error {
  readonly category: ErrorCategory;
  readonly phase?: string;
  readonly retryable: boolean;
  readonly cause?: Error;

  constructor(message: string, category: ErrorCategory, opts?: { phase?: string; retryable?: boolean; cause?: Error }) {
    super(message);
    this.name = "TaskError";
    this.category = category;
    this.phase = opts?.phase;
    this.retryable = opts?.retryable ?? false;
    this.cause = opts?.cause;
  }
}

// ─── Pattern matchers ───────────────────────────────────────────────────

const TRANSIENT_PATTERNS = [
  /econnreset/i,
  /econnrefused/i,
  /etimedout/i,
  /socket hang up/i,
  /fetch failed/i,
  /econnaborted/i,
  /enoent/i, // "claude" not found → transient install issue
];

const RATE_LIMIT_PATTERNS = [/429/, /rate.?limit/i, /overloaded/i, /capacity/i, /too many requests/i];

const QUOTA_PATTERNS = [/usage limit/i, /quota exceeded/i, /billing/i];

const TIMEOUT_PATTERNS = [/timed out/i, /timeout/i];

const TASK_FAILURE_PATTERNS = [/exited with code/i, /sigterm/i, /sigkill/i, /aborted/i];

function matchAny(msg: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(msg));
}

/**
 * Classify an unknown error into a structured TaskError.
 * Already-classified TaskErrors pass through unchanged.
 */
export function classifyError(err: unknown): TaskError {
  if (err instanceof TaskError) return err;

  const msg = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err : new Error(msg);

  // Order matters: more specific patterns first
  if (matchAny(msg, QUOTA_PATTERNS)) {
    return new TaskError(msg, "quota_exceeded", { cause });
  }

  if (matchAny(msg, RATE_LIMIT_PATTERNS)) {
    return new TaskError(msg, "rate_limited", { retryable: true, cause });
  }

  // Pipeline phase failures must be checked before timeout — "Reviewer phase failed: timeout"
  const pipelineMatch = msg.match(/^(planner|developer|tester|reviewer) phase failed/i);
  if (pipelineMatch) {
    return new TaskError(msg, "pipeline_failure", {
      phase: pipelineMatch[1].toLowerCase(),
      retryable: true,
      cause,
    });
  }

  if (matchAny(msg, TIMEOUT_PATTERNS)) {
    return new TaskError(msg, "task_timeout", { retryable: true, cause });
  }

  if (matchAny(msg, TRANSIENT_PATTERNS)) {
    return new TaskError(msg, "transient", { retryable: true, cause });
  }

  if (matchAny(msg, TASK_FAILURE_PATTERNS)) {
    return new TaskError(msg, "task_failure", { cause });
  }

  return new TaskError(msg, "permanent", { cause });
}

// ─── Scheduling strategies ──────────────────────────────────────────────

export interface RetryStrategy {
  shouldRetry: boolean;
  backoffMs: number;
  pauseRunMs: number; // >0 means pause the entire run
  maxRetries: number;
}

const STRATEGY_DEFAULTS: Record<ErrorCategory, RetryStrategy> = {
  transient: { shouldRetry: true, backoffMs: 30_000, pauseRunMs: 0, maxRetries: 3 },
  rate_limited: { shouldRetry: true, backoffMs: 0, pauseRunMs: 60_000, maxRetries: 3 },
  quota_exceeded: { shouldRetry: false, backoffMs: 0, pauseRunMs: 0, maxRetries: 0 },
  task_timeout: { shouldRetry: true, backoffMs: 10_000, pauseRunMs: 0, maxRetries: 2 },
  task_failure: { shouldRetry: false, backoffMs: 0, pauseRunMs: 0, maxRetries: 0 },
  pipeline_failure: { shouldRetry: true, backoffMs: 5_000, pauseRunMs: 0, maxRetries: 1 },
  permanent: { shouldRetry: false, backoffMs: 0, pauseRunMs: 0, maxRetries: 0 },
};

export function getRetryStrategy(category: ErrorCategory): RetryStrategy {
  return { ...STRATEGY_DEFAULTS[category] };
}
