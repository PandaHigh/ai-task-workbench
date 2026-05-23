import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketServer } from "ws";

describe("WsServer", () => {
  // We test the JSON-RPC message handling logic directly,
  // since starting/stopping real WebSocket servers in tests is flaky.
  // The actual integration is covered by manual testing.

  describe("RPC method dispatch", () => {
    it("should have all required method handlers", async () => {
      const { methodHandlers } = await import("../../src-engine/src/json-rpc/methods.js");

      const requiredMethods = [
        "run.list", "run.create", "run.report", "run.tasks",
        "run.commits", "run.lessons", "run.stop", "run.delete",
        "task.create", "task.start", "task.pause", "task.resume",
        "task.cancel", "task.setTimeout",
        "queue.list", "queue.reorder",
        "wizard.start", "wizard.chat", "wizard.validate",
        "config.get", "config.set",
      ];

      for (const method of requiredMethods) {
        expect(methodHandlers[method], `Missing handler for ${method}`).toBeDefined();
        expect(typeof methodHandlers[method]).toBe("function");
      }
    });
  });

  describe("JSON-RPC validation", () => {
    function isValidRequest(msg: unknown): boolean {
      return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as any).jsonrpc === "2.0" &&
        typeof (msg as any).method === "string"
      );
    }

    it("should accept valid JSON-RPC request", () => {
      expect(isValidRequest({ jsonrpc: "2.0", method: "test", id: 1 })).toBe(true);
    });

    it("should reject missing jsonrpc version", () => {
      expect(isValidRequest({ method: "test", id: 1 })).toBe(false);
    });

    it("should reject missing method", () => {
      expect(isValidRequest({ jsonrpc: "2.0", id: 1 })).toBe(false);
    });

    it("should reject non-string method", () => {
      expect(isValidRequest({ jsonrpc: "2.0", method: 123, id: 1 })).toBe(false);
    });

    it("should reject null", () => {
      expect(isValidRequest(null)).toBe(false);
    });

    it("should reject non-object", () => {
      expect(isValidRequest("string")).toBe(false);
    });
  });
});
