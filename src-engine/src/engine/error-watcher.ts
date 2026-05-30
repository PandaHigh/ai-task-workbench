import type { DetectedError, ErrorSeverity } from "@ai-workbench/shared";
import type { Store } from "../db/store.js";
import { randomUUID } from "crypto";

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

interface ErrorPattern {
  regex: RegExp;
  category: DetectedError["category"];
  severity: ErrorSeverity;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  { regex: /SyntaxError:\s*(.+)/, category: "syntax", severity: "critical" },
  { regex: /Unexpected token/, category: "syntax", severity: "critical" },
  { regex: /TypeError:\s*(.+)/, category: "type", severity: "critical" },
  { regex: /TS\d+:\s*(.+)/, category: "type", severity: "warning" },
  { regex: /Cannot find module ['"]([^'"]+)['"]/, category: "import", severity: "critical" },
  { regex: /Module not found:\s*(.+)/, category: "import", severity: "critical" },
  { regex: /ENOENT:\s*no such file.*['"]([^'"]+)['"]/, category: "runtime", severity: "warning" },
  { regex: /ECONNREFUSED/, category: "runtime", severity: "warning" },
  { regex: /ECONNRESET/, category: "runtime", severity: "warning" },
  { regex: /AssertionError:\s*(.+)/, category: "test_failure", severity: "warning" },
  { regex: /FAIL\s+(.+)/, category: "test_failure", severity: "warning" },
  { regex: /expected.*received/i, category: "test_failure", severity: "warning" },
  { regex: /Error:\s*(.+)/, category: "unknown", severity: "warning" },
];

const FILE_LINE_REGEX = /^(.+?):(\d+):\d+/;

export class ErrorWatcher {
  constructor(
    private notify: NotifyFn,
    private store: Store,
  ) {}

  processStderr(data: string, runId: string, taskId?: string): void {
    const lines = data.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      for (const pattern of ERROR_PATTERNS) {
        if (pattern.regex.test(line)) {
          const error = this.createError(line, pattern, runId, taskId);
          this.store.appendDetectedError(runId, error);
          this.notify("error.detected", { error });
          break; // One match per line
        }
      }
    }
  }

  private createError(
    line: string,
    pattern: ErrorPattern,
    runId: string,
    taskId?: string,
  ): DetectedError {
    const fileLineMatch = FILE_LINE_REGEX.exec(line);
    return {
      id: randomUUID().slice(0, 12),
      runId,
      taskId,
      severity: pattern.severity,
      category: pattern.category,
      message: line.trim().substring(0, 500),
      file: fileLineMatch?.[1],
      line: fileLineMatch?.[2] ? parseInt(fileLineMatch[2], 10) : undefined,
      timestamp: Date.now(),
    };
  }
}
