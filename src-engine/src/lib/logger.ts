type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

export const log = {
  debug: (msg: string, ...args: unknown[]) => {
    if (shouldLog("debug")) console.log(`[debug] ${msg}`, ...args);
  },
  info: (msg: string, ...args: unknown[]) => {
    if (shouldLog("info")) console.log(`[info] ${msg}`, ...args);
  },
  warn: (msg: string, ...args: unknown[]) => {
    if (shouldLog("warn")) console.warn(`[warn] ${msg}`, ...args);
  },
  error: (msg: string, ...args: unknown[]) => {
    if (shouldLog("error")) console.error(`[error] ${msg}`, ...args);
  },
};
