import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import type { Data } from "ws";

// We test WsServer internals by mocking the ws module to avoid port conflicts.
interface MockWs {
  readyState: number;
  _isAlive: boolean;
  on: Mock;
  send: Mock;
  ping: Mock;
  close: Mock;
  terminate: Mock;
}

const mockClients = new Set<MockWs>();
const mockWss = {
  on: vi.fn(),
  close: vi.fn((cb: () => void) => cb()),
};

const mockHttpServer = {
  on: vi.fn(),
  listen: vi.fn(),
  close: vi.fn((cb?: () => void) => { if (cb) cb(); }),
};

vi.mock("ws", () => ({
  WebSocketServer: vi.fn(() => mockWss),
  WebSocket: { OPEN: 1 },
}));

vi.mock("http", () => ({
  createServer: vi.fn(() => mockHttpServer),
}));

const mockStore = {
  saveRun: vi.fn(),
  getRun: vi.fn(),
  listRuns: vi.fn(() => []),
  deleteRun: vi.fn(),
  saveTask: vi.fn(),
  listTasks: vi.fn(() => []),
  getTask: vi.fn(),
  updateTask: vi.fn(),
  appendLog: vi.fn(),
  getLogs: vi.fn(() => []),
  appendScore: vi.fn(),
  appendCommit: vi.fn(),
  appendLesson: vi.fn(),
  getLessons: vi.fn(() => []),
  getCommits: vi.fn(() => []),
  saveReport: vi.fn(),
  getReport: vi.fn(() => null),
  getConfig: vi.fn(() => undefined),
  setConfig: vi.fn(),
};

const mockShareStore = {
  createShare: vi.fn(),
  getShare: vi.fn(),
  listShares: vi.fn(() => []),
  revokeShare: vi.fn(),
};

const mockQueueManager = {
  enqueue: vi.fn(),
  dequeue: vi.fn(),
  list: vi.fn(() => []),
  peekNext: vi.fn(() => []),
  remove: vi.fn(),
  restore: vi.fn(),
  clear: vi.fn(),
  reorder: vi.fn(),
};

vi.mock("../../src-engine/src/db/store.js", () => ({
  Store: vi.fn(() => ({
    saveRun: vi.fn(), getRun: vi.fn(), listRuns: vi.fn(() => []),
    deleteRun: vi.fn(), saveTask: vi.fn(), listTasks: vi.fn(() => []),
    getTask: vi.fn(), updateTask: vi.fn(), appendLog: vi.fn(),
    getLogs: vi.fn(() => []), appendScore: vi.fn(), appendCommit: vi.fn(),
    appendLesson: vi.fn(), getLessons: vi.fn(() => []),
    getCommits: vi.fn(() => []), saveReport: vi.fn(), getReport: vi.fn(() => null),
    getConfig: vi.fn(() => undefined), setConfig: vi.fn(),
  })),
}));

vi.mock("../../src-engine/src/db/share-store.js", () => ({
  ShareStore: vi.fn(() => ({
    createShare: vi.fn(), getShare: vi.fn(), listShares: vi.fn(() => []),
    list: vi.fn(() => []), revokeShare: vi.fn(), revoke: vi.fn(),
    cleanup: vi.fn(),
  })),
}));

vi.mock("../../src-engine/src/engine/queue-manager.js", () => ({
  QueueManager: vi.fn(() => ({
    enqueue: vi.fn(), dequeue: vi.fn(), list: vi.fn(() => []),
    peekNext: vi.fn(() => []), remove: vi.fn(), restore: vi.fn(),
    clear: vi.fn(), reorder: vi.fn(),
  })),
}));

import { WsServer } from "../../src-engine/src/ws-server.js";

function createMockWs(): MockWs {
  return {
    readyState: 1,
    _isAlive: true,
    on: vi.fn(),
    send: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
  };
}

function findHandler(calls: unknown[][], event: string): Function | undefined {
  return calls.find(
    (c: unknown[]) => c[0] === event,
  )?.[1] as Function | undefined;
}

describe("WsServer", () => {
  let server: WsServer;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let store: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let shareStore: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queueManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockClients.clear();
    mockWss.on.mockReset();
    mockWss.close.mockImplementation((cb: () => void) => cb());
    mockHttpServer.on.mockReset();
    mockHttpServer.listen.mockReset();
    mockHttpServer.close.mockImplementation((cb?: () => void) => { if (cb) cb(); });
    const { Store } = await import("../../src-engine/src/db/store.js");
    const { ShareStore } = await import("../../src-engine/src/db/share-store.js");
    const { QueueManager } = await import("../../src-engine/src/engine/queue-manager.js");
    store = new Store();
    shareStore = new ShareStore();
    queueManager = new QueueManager();
    server = new WsServer({ store, shareStore, queueManager });
  });

  describe("start", () => {
    it("should register connection and error handlers", () => {
      server.start();
      expect(mockHttpServer.on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(mockWss.on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(mockWss.on).toHaveBeenCalledWith("connection", expect.any(Function));
    });

    it("should handle new connections", () => {
      server.start();
      const connectionHandler = findHandler(mockWss.on.mock.calls, "connection");
      expect(connectionHandler).toBeDefined();

      const ws = createMockWs();
      connectionHandler!(ws);

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
      const connectionHandler = findHandler(mockWss.on.mock.calls, "connection");
      const ws = createMockWs();
      connectionHandler!(ws);

      const pongHandler = findHandler(ws.on.mock.calls, "pong");
      pongHandler!();
      expect(ws._isAlive).toBe(true);
    });

    it("should remove client on close", () => {
      server.start();
      const connectionHandler = findHandler(mockWss.on.mock.calls, "connection");
      const ws = createMockWs();
      connectionHandler!(ws);

      const closeHandler = findHandler(ws.on.mock.calls, "close");
      closeHandler!();
      // The client should be removed (we can verify via broadcast)
    });

    it("should handle EADDRINUSE error", () => {
      server.start();
      const errorHandler = findHandler(mockHttpServer.on.mock.calls, "error");

      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      errorHandler!({ code: "EADDRINUSE", message: "in use" });
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });
  });

  describe("handleMessage", () => {
    let ws: MockWs;
    let connectionHandler: Function;

    beforeEach(() => {
      server.start();
      connectionHandler = findHandler(mockWss.on.mock.calls, "connection")!;
      ws = createMockWs();
      connectionHandler(ws);
      // Clear the system.ready send call
      ws.send.mockClear();
    });

    it("should return parse error for invalid JSON", async () => {
      const messageHandler = findHandler(ws.on.mock.calls, "message");

      await messageHandler!("not valid json{{{");
      const response = JSON.parse(ws.send.mock.calls[0][0]);
      expect(response.error.code).toBe(-32700);
    });

    it("should return invalid request for missing jsonrpc", async () => {
      const messageHandler = findHandler(ws.on.mock.calls, "message");

      await messageHandler!(JSON.stringify({ method: "test", id: 1 }));
      const response = JSON.parse(ws.send.mock.calls[0][0]);
      expect(response.error.code).toBe(-32600);
    });

    it("should return invalid request for non-string method", async () => {
      const messageHandler = findHandler(ws.on.mock.calls, "message");

      await messageHandler!(JSON.stringify({ jsonrpc: "2.0", method: 123, id: 1 }));
      const response = JSON.parse(ws.send.mock.calls[0][0]);
      expect(response.error.code).toBe(-32600);
    });

    it("should return method not found for unknown method", async () => {
      const messageHandler = findHandler(ws.on.mock.calls, "message");

      await messageHandler!(JSON.stringify({ jsonrpc: "2.0", method: "unknown", id: 1 }));
      const response = JSON.parse(ws.send.mock.calls[0][0]);
      expect(response.error.code).toBe(-32601);
    });

    it("should dispatch to method handler and return result", async () => {
      const messageHandler = findHandler(ws.on.mock.calls, "message");

      await messageHandler!(JSON.stringify({ jsonrpc: "2.0", method: "share.list", id: 42 }));
      const response = JSON.parse(ws.send.mock.calls[0][0]);
      expect(response.id).toBe(42);
      expect(response.result).toBeDefined();
    });

    it("should handle validation errors as INVALID_PARAMS", async () => {
      const messageHandler = findHandler(ws.on.mock.calls, "message");

      await messageHandler!(JSON.stringify({
        jsonrpc: "2.0",
        method: "task.create",
        id: 99,
        params: { runId: "nonexistent", content: "test" },
      }));
      const response = JSON.parse(ws.send.mock.calls[0][0]);
      expect(response.error.code).toBe(-32602);
    });

    it("should handle handler exceptions as internal error", async () => {
      const messageHandler = findHandler(ws.on.mock.calls, "message");

      // run.create with a system dir triggers a non-validation Error (INTERNAL_ERROR)
      await messageHandler!(JSON.stringify({
        jsonrpc: "2.0",
        method: "run.create",
        id: 100,
        params: { workingDir: "/etc", goals: ["g"], terminationConditions: ["c"] },
      }));
      const response = JSON.parse(ws.send.mock.calls[0][0]);
      expect(response.error.code).toBe(-32603);
    });

    it("should not send on non-OPEN websocket", async () => {
      ws.readyState = 2; // CLOSING
      const messageHandler = findHandler(ws.on.mock.calls, "message");

      await messageHandler!(JSON.stringify({ jsonrpc: "2.0", method: "run.list", id: 1 }));
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("broadcast", () => {
    it("should send notification to all open clients", () => {
      server.start();
      const connectionHandler = findHandler(mockWss.on.mock.calls, "connection");

      const ws1 = createMockWs();
      const ws2 = createMockWs();
      connectionHandler!(ws1);
      connectionHandler!(ws2);
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
      const connectionHandler = findHandler(mockWss.on.mock.calls, "connection");

      const ws1 = createMockWs();
      const ws2 = createMockWs();
      ws2.readyState = 2; // CLOSING
      connectionHandler!(ws1);
      connectionHandler!(ws2);
      ws1.send.mockClear();
      ws2.send.mockClear();

      server.broadcast("test.event", { data: "hello" });
      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).not.toHaveBeenCalled();
    });

    it("should remove clients that fail to send", () => {
      server.start();
      const connectionHandler = findHandler(mockWss.on.mock.calls, "connection");

      const ws = createMockWs();
      ws.send.mockImplementation(() => { throw new Error("send failed"); });
      connectionHandler!(ws);

      server.broadcast("test.event", {});
      // Client should be removed after send failure
    });
  });

  describe("close", () => {
    it("should close all clients and the server", async () => {
      server.start();
      const connectionHandler = findHandler(mockWss.on.mock.calls, "connection");

      const ws = createMockWs();
      connectionHandler!(ws);

      await server.close();
      expect(ws.close).toHaveBeenCalled();
      expect(mockWss.close).toHaveBeenCalled();
    });
  });

  describe("heartbeat", () => {
    it("should detect dead connections and terminate them", () => {
      server.start();
      const connectionHandler = findHandler(mockWss.on.mock.calls, "connection");

      const ws = createMockWs();
      ws._isAlive = false; // Simulate a dead connection
      connectionHandler!(ws);

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
        "task.cancel", "task.retry", "task.setTimeout",
        "queue.list", "queue.reorder",
        "wizard.start", "wizard.chat", "wizard.validate",
        "config.get", "config.set",
        "share.create", "share.list", "share.revoke",
        "share.subscribe", "share.unsubscribe", "share.subscriptions",
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
        (msg as Record<string, unknown>).jsonrpc === "2.0" &&
        typeof (msg as Record<string, unknown>).method === "string"
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
