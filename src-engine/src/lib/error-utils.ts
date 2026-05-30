export function errorToMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const RETRYABLE_PATTERNS = [
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /socket hang up/i,
  /fetch failed/i,
  /network/i,
  /timeout/i,
  /rate.limit/i,
  /429/,
  /502/,
  /503/,
  /504/,
  /overloaded/i,
  /capacity/i,
];

export function isRetryableError(err: unknown): boolean {
  const msg = errorToMessage(err);
  return RETRYABLE_PATTERNS.some((p) => p.test(msg));
}
