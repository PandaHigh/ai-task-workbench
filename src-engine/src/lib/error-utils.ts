export function errorToMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Re-export from unified error classification
export { classifyError, getRetryStrategy, TaskError, type ErrorCategory, type RetryStrategy } from "./error-types.js";
