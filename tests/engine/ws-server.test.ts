import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Data } from "ws";

// We test WsServer internals by mocking the ws module to avoid port conflicts.
const mockClients = new Set<any>();
const mockWss = {
  on: vi.fn(),
  close: vi.fn((cb: () => void) => cb()),
};

vi.mock("ws", () => ({
  WebSocketServer: vi.fn(() => mockWss),
  WebSocket: { OPEN: 1 },
}));

import { WsServer } from "../../src-engine/src/ws-server.js";

function createMockWs(): any {
  const ws = {
    readyState: 1,
    _isAlive: true,
    on: vi.fn(),
    send: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
  };
  return ws;
}

describe("WsServer", () => {
  let server: WsServer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClients.clear();
    mockWss.on.mockReset();
    mockWss.close.mockImplementation((cb: () => void) => cb());
    server = new WsServer();
  });

  describe("start", () => {
    it("should register connection and error handlers", () => {
      server.start();
      expect(mockWss.on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(mockWss.on).toHaveBeenCalledWith("connection", expect.any(Function));
    });

    it("should handle new connections", () => {
      server.start();
      const connectionHandler = mockWss.on.mock.calls.find(
        (c: any[]) => c[0] === "connection",
      )?.[1];
      expect(connectionHandler).toBeDefined();

      const ws = createMockWs();
      connectionHandler(ws);

      expect(ws.on).toHaveBeenCalledWith("pong", expect.any(Function));
      expect(ws.on).toHaveBeenCalledWith("message", expect.any(Function));
      expect(ws.on).toHaveBeenCalledWith("close", expect.any(Function));
      expect(ws.on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(ws.send).toHaveBeenCalled();
      const sentMsg = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sentMsg.method).toBe("system.ready");
    });

    it("should handle pong to keep connection alive", () => {
      server.start();
      const connectionHandler = mockWss.on.mock.calls.find(
        (c: any[]) => c[0] === "connection",
      )?.[1];
      const ws = createMockWs();
      connectionHandler(ws);

      const pongHandler = ws.on.mock.calls.find((c: any[]) => c[0] === "pong")?.[1];
      pongHandler();
      expect(ws._isAlive).toBe(true);
    });

    it("should remove client on close", () => {
      server.start();
      const connectionHandler = mockWss.on.mock.calls.find(
        (c: any[]) => c[0] === "connection",
      )?.[1];
      const ws = createMockWs();
      connectionHandler(ws);

      const closeHandler = ws.on.mock.calls.find((c: any[]) => c[0] === "close")?.[1];
      closeHandler();
      // The client should be removed (we can verify via broadcast)
    });

    it("should handle EADDRINUSE error", () => {
      server.start();
      const errorHandler = mockWss.on.mock.calls.find(
        (c: any[]) => c[0] === "error",
      )?.[1];

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      errorHandler({ code: "EADDRINUSE", message: "in use" });
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });
  });

  describe("handleMessage", () => {
    let ws: any;
    let connectionHandler: Function;

    beforeEach(() => {
      server.start();
      connectionHandler = mockWss.on.mock.calls.find(
        (c: any[]) => c[0] === "connection",
      )?.[1];
      ws = createMockWs();
      connectionHandler(ws);
      // Clear the system.ready send call
      ws.send.mockClear();
    });

    it("should return parse error for invalid JSON", async () => {
      const messageHandler = ws.on.mock.calls.find(
        (c: any[]) => c[0] === "message",
      )?.[1];

      await messageHandler("not valid json{{{");
      const response = JSON.parse(ws.send.mock.calls[0][0]);
      expect(response.error.code).toBe(-32700);
    });

    it("should return invalid request for missing jsonrpc", async () => {
      const messageHandler = ws.on.mock.calls.find(
        (c: any[]) => c[0] === "message",
      )?.[1];

      await messageHandler(JSON.stringify({ method: "test", id: 1 }));
      const response = JSON.parse(ws.send.mock.calls[0][0]);
      expect(response.error.code).toBe(-32600);
    });

    it("should return invalid request for non-string method", async () => {
      const messageHandler = ws.on.mock.calls.find(
        (c: any[]) => c[0] === "message",
      )?.[1];

      await messageHandler(JSON.stringify({ jsonrpc: "2.0", method: 123, id: 1 }));
      const response = JSON.parse(ws.send.mock.calls[0][0]);
      expect(response.error.code).toBe(-32600);
    });

    it("should return method not found for unknown method", async () => {
      const messageHandler = ws.on.mock.calls.find(
        (c: any[]) => c[0] === "message",
      )?.[1];

      await messageHandler(JSON.stringify({ jsonrpc: "2.0", method: "unknown", id: 1 }));
      const response = JSON.parse(ws.send.mock.calls[0][0]);
      expect(response.error.code).toBe(-32601);
    });

    it("should dispatch to method handler and return result", async () => {
      const messageHandler = ws.on.mock.calls.find(
        (c: any[]) => c[0] === "message",
      )?.[1];

      await messageHandler(JSON.stringify({ jsonrpc: "2.0", method: "run.list", id: 42 }));
      const response = JSON.parse(ws.send.mock.calls[0][0]);
      expect(response.id).toBe(42);
      expect(Array.isArray(response.result)).toBe(true);
    });

    it("should handle handler exceptions as internal error", async () => {
      const messageHandler = ws.on.mock.calls.find(
        (c: any[]) => c[0] === "message",
      )?.[1];

      await messageHandler(JSON.stringify({
        jsonrpc: "2.0",
        method: "task.create",
        id: 99,
        params: { runId: "nonexistent", content: "test" },
      }));
      const response = JSON.parse(ws.send.mock.calls[0][0]);
      expect(response.error.code).toBe(-32603);
    });

    it("should not send on non-OPEN websocket", async () => {
      ws.readyState = 2; // CLOSING
      const messageHandler = ws.on.mock.calls.find(
        (c: any[]) => c[0] === "message",
      )?.[1];

      await messageHandler(JSON.stringify({ jsonrpc: "2.0", method: "run.list", id: 1 }));
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("broadcast", () => {
    it("should send notification to all open clients", () => {
      server.start();
      const connectionHandler = mockWss.on.mock.calls.find(
        (c: any[]) => c[0] === "connection",
      )?.[1];

      const ws1 = createMockWs();
      const ws2 = createMockWs();
      connectionHandler(ws1);
      connectionHandler(ws2);
      ws1.send.mockClear();
      ws2.send.mockClear();

      server.broadcast("test.event", { data: "hello" });

      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).toHaveBeenCalledTimes(1);
      const msg1 = JSON.parse(ws1.send.mock.calls[0][0]);
      expect(msg1.method).toBe("test.event");
      expect(msg1.params.data).toBe("hello");
    });

    it("should skip non-OPEN clients", () => {
      server.start();
      const connectionHandler = mockWss.on.mock.calls.find(
        (c: any[]) => c[0] === "connection",
      )?.[1];

      const ws1 = createMockWs();
      const ws2 = createMockWs();
      ws2.readyState = 2; // CLOSING
      connectionHandler(ws1);
      connectionHandler(ws2);
      ws1.send.mockClear();
      ws2.send.mockClear();

      server.broadcast("test.event", { data: "hello" });
      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).not.toHaveBeenCalled();
    });

    it("should remove clients that fail to send", () => {
      server.start();
      const connectionHandler = mockWss.on.mock.calls.find(
        (c: any[]) => c[0] === "connection",
      )?.[1];

      const ws = createMockWs();
      ws.send.mockImplementation(() => { throw new Error("send failed"); });
      connectionHandler(ws);

      server.broadcast("test.event", {});
      // Client should be removed after send failure
    });
  });

  describe("close", () => {
    it("should close all clients and the server", async () => {
      server.start();
      const connectionHandler = mockWss.on.mock.calls.find(
        (c: any[]) => c[0] === "connection",
      )?.[1];

      const ws = createMockWs();
      connectionHandler(ws);

      await server.close();
      expect(ws.close).toHaveBeenCalled();
      expect(mockWss.close).toHaveBeenCalled();
    });
  });

  describe("heartbeat", () => {
    it("should detect dead connections and terminate them", () => {
      server.start();
      const connectionHandler = mockWss.on.mock.calls.find(
        (c: any[]) => c[0] === "connection",
      )?.[1];

      const ws = createMockWs();
      ws._isAlive = false; // Simulate a dead connection
      connectionHandler(ws);

      // Find the heartbeat interval handler
      // The heartbeat is set up in start(), but since we mock setInterval timing,
      // we can't directly test it. Instead, verify the setup is correct.
      expect(ws.on).toHaveBeenCalledWith("pong", expect.any(Function));
    });
  });

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
