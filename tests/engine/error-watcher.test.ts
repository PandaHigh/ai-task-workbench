import { describe, it, expect, beforeEach, vi } from "vitest";

const mockStoreInstance = {
  appendDetectedError: vi.fn(),
};

vi.doMock("../../src-engine/src/db/store.js", () => ({
  Store: vi.fn().mockImplementation(() => mockStoreInstance),
}));

import { ErrorWatcher } from "../../src-engine/src/engine/error-watcher.js";

describe("ErrorWatcher", () => {
  let watcher: ErrorWatcher;
  let mockNotify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockNotify = vi.fn();
    watcher = new ErrorWatcher(mockNotify, mockStoreInstance as any);
  });

  describe("processStderr", () => {
    it("detects syntax errors", () => {
      watcher.processStderr("SyntaxError: Unexpected end of input", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          category: "syntax",
          severity: "critical",
        }),
      );
      expect(mockNotify).toHaveBeenCalledWith(
        "error.detected",
        expect.objectContaining({
          error: expect.objectContaining({ category: "syntax" }),
        }),
      );
    });

    it("detects unexpected token errors", () => {
      watcher.processStderr("Unexpected token '{'", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          category: "syntax",
          severity: "critical",
        }),
      );
    });

    it("detects type errors", () => {
      watcher.processStderr("TypeError: Cannot read properties of undefined (reading 'map')", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          category: "type",
          severity: "critical",
        }),
      );
    });

    it("detects TypeScript diagnostic errors", () => {
      watcher.processStderr("TS2322: Type 'string' is not assignable to type 'number'", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          category: "type",
          severity: "warning",
        }),
      );
    });

    it("detects import errors - Cannot find module", () => {
      watcher.processStderr("Cannot find module './utils'", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          category: "import",
          severity: "critical",
        }),
      );
    });

    it("detects import errors - Module not found", () => {
      watcher.processStderr("Module not found: Error: Can't resolve 'lodash'", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          category: "import",
          severity: "critical",
        }),
      );
    });

    it("detects runtime errors - ENOENT", () => {
      watcher.processStderr("ENOENT: no such file or directory, open '/tmp/missing.txt'", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          category: "runtime",
          severity: "warning",
        }),
      );
    });

    it("detects runtime errors - ECONNREFUSED", () => {
      watcher.processStderr("Error: connect ECONNREFUSED 127.0.0.1:5432", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          category: "runtime",
          severity: "warning",
        }),
      );
    });

    it("detects runtime errors - ECONNRESET", () => {
      watcher.processStderr("Error: read ECONNRESET", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          category: "runtime",
          severity: "warning",
        }),
      );
    });

    it("detects test failures - AssertionError", () => {
      watcher.processStderr("AssertionError: expected true to be false", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          category: "test_failure",
          severity: "warning",
        }),
      );
    });

    it("detects test failures - FAIL", () => {
      watcher.processStderr("FAIL tests/unit/calculator.test.ts", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          category: "test_failure",
          severity: "warning",
        }),
      );
    });

    it("detects test failures - expected/received", () => {
      watcher.processStderr("expected 5 received 3", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          category: "test_failure",
          severity: "warning",
        }),
      );
    });

    it("falls through to generic Error pattern", () => {
      watcher.processStderr("Error: something went wrong", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          category: "unknown",
          severity: "warning",
        }),
      );
    });

    it("skips empty/whitespace lines", () => {
      watcher.processStderr("   \n\n  \n", "run-1");

      expect(mockStoreInstance.appendDetectedError).not.toHaveBeenCalled();
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("handles multiple lines with multiple errors", () => {
      watcher.processStderr("SyntaxError: bad code\nSomething unrelated\nTypeError: bad type", "run-1");

      // Two errors detected (syntax + type), one line has no match
      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledTimes(2);
      expect(mockNotify).toHaveBeenCalledTimes(2);
    });

    it("only matches first pattern per line", () => {
      // This line contains both "Error:" and "TypeError:" but should only match once
      watcher.processStderr("Error: TypeError: bad things", "run-1");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledTimes(1);
    });

    it("truncates messages over 500 chars", () => {
      const longMsg = "SyntaxError: " + "x".repeat(600);
      watcher.processStderr(longMsg, "run-1");

      const savedError = mockStoreInstance.appendDetectedError.mock.calls[0][1];
      expect(savedError.message.length).toBeLessThanOrEqual(500);
    });

    it("passes taskId through to the detected error", () => {
      watcher.processStderr("SyntaxError: bad code", "run-1", "task-42");

      expect(mockStoreInstance.appendDetectedError).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          taskId: "task-42",
          runId: "run-1",
        }),
      );
    });

    it("handles missing taskId (undefined)", () => {
      watcher.processStderr("SyntaxError: bad code", "run-1");

      const savedError = mockStoreInstance.appendDetectedError.mock.calls[0][1];
      expect(savedError.taskId).toBeUndefined();
    });

    it("extracts file and line number from error output", () => {
      watcher.processStderr("src/index.ts:10:5 - error TS2322: Type 'string' is not assignable", "run-1");

      const savedError = mockStoreInstance.appendDetectedError.mock.calls[0][1];
      expect(savedError.file).toBe("src/index.ts");
      expect(savedError.line).toBe(10);
    });

    it("generates an id and timestamp for each error", () => {
      watcher.processStderr("SyntaxError: bad code", "run-1");

      const savedError = mockStoreInstance.appendDetectedError.mock.calls[0][1];
      expect(savedError.id).toBeDefined();
      expect(savedError.id.length).toBeGreaterThan(0);
      expect(savedError.timestamp).toBeTypeOf("number");
    });
  });
});
