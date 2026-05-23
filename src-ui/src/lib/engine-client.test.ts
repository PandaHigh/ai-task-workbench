import { describe, it, expect, vi, beforeEach } from "vitest";

interface MockWs {
  readyState: number;
  _isAlive?: boolean;
  _ws: MockWsInner;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface MockWsInner {
  readyState: number;
  url: string;
  onopen: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  send: (data: string) => void;
  close: () => void;
}

describe("EngineClient", () => {
  let client: typeof import("./engine-client")["engineClient"];
  let mockWsInstance: MockWs;
  let sentMessages: string[];

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    sentMessages = [];
    mockWsInstance = {
      readyState: 0,
      _ws: null as unknown as MockWsInner,
      send: vi.fn((data: string) => { sentMessages.push(data); }),
      close: vi.fn(() => {
        mockWsInstance.readyState = 3;
        mockWsInstance._ws?.onclose?.(new CloseEvent("close", { code: 1000, reason: "" }));
      }),
    };

    vi.stubGlobal("WebSocket", class {
      static OPEN = 1;
      static CLOSED = 3;
      static CONNECTING = 0;
      static CLOSING = 2;
      url: string;
      readyState = 0;
      onopen: ((ev: Event) => void) | null = null;
      onclose: ((ev: CloseEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        const inner = this as unknown as MockWsInner;
        inner.send = mockWsInstance.send;
        inner.close = mockWsInstance.close;
        mockWsInstance._ws = inner;
      }

      send(data: string) { sentMessages.push(data); }
      close() { mockWsInstance.close(); }
    });

    const mod = await import("./engine-client");
    client = mod.engineClient;
  });

  it("isConnected returns false initially", () => {
    expect(client.isConnected()).toBe(false);
  });

  it("onNotification returns unsubscribe function", () => {
    const handler = vi.fn();
    const unsub = client.onNotification(handler);
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("connects and fires onopen", async () => {
    const connectPromise = client.connect();

    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstance._ws;
    ws.readyState = 1;
    ws.onopen!(new Event("open"));

    await connectPromise;
    expect(client.isConnected()).toBe(true);
  });

  it("sends JSON-RPC request via call()", async () => {
    const connectPromise = client.connect();
    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstance._ws;
    ws.readyState = 1;
    ws.onopen!(new Event("open"));
    await connectPromise;

    const callPromise = client.call("run.list");

    const sent = sentMessages[sentMessages.length - 1];
    expect(sent).toBeDefined();
    const parsed = JSON.parse(sent);
    expect(parsed.jsonrpc).toBe("2.0");
    expect(parsed.method).toBe("run.list");
    expect(parsed.id).toBeDefined();

    ws.onmessage!(new MessageEvent("message", { data: JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: [] }) }));

    const result = await callPromise;
    expect(result).toEqual([]);
  });

  it("call rejects on error response", async () => {
    const connectPromise = client.connect();
    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstance._ws;
    ws.readyState = 1;
    ws.onopen!(new Event("open"));
    await connectPromise;

    const callPromise = client.call("test.method");

    const sent = sentMessages[sentMessages.length - 1];
    const parsed = JSON.parse(sent);

    ws.onmessage!(new MessageEvent("message", {
      data: JSON.stringify({ jsonrpc: "2.0", id: parsed.id, error: { code: -32000, message: "Internal error" } }),
    }));

    await expect(callPromise).rejects.toThrow("Internal error");
  });

  it("call rejects when not connected", async () => {
    client.disconnect();
    await expect(client.call("test.method")).rejects.toThrow("Engine not connected");
  });

  it("dispatches notifications to handlers", async () => {
    const connectPromise = client.connect();
    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstance._ws;
    ws.readyState = 1;
    ws.onopen!(new Event("open"));
    await connectPromise;

    const handler = vi.fn();
    client.onNotification(handler);

    ws.onmessage!(new MessageEvent("message", {
      data: JSON.stringify({ jsonrpc: "2.0", method: "run.status", params: { runId: "r1", status: "running" } }),
    }));

    expect(handler).toHaveBeenCalledWith("run.status", { runId: "r1", status: "running" });
  });

  it("disconnect clears connection state", async () => {
    const connectPromise = client.connect();
    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstance._ws;
    ws.readyState = 1;
    ws.onopen!(new Event("open"));
    await connectPromise;

    expect(client.isConnected()).toBe(true);

    client.disconnect();

    ws.onclose!(new CloseEvent("close", { code: 1000, reason: "" }));

    expect(client.isConnected()).toBe(false);
  });

  it("handles non-JSON messages gracefully", async () => {
    const connectPromise = client.connect();
    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstance._ws;
    ws.readyState = 1;
    ws.onopen!(new Event("open"));
    await connectPromise;

    expect(() => {
      ws.onmessage!(new MessageEvent("message", { data: "not-json" }));
    }).not.toThrow();
  });

  it("handles connection error", async () => {
    const connectPromise = client.connect();
    await new Promise((r) => setTimeout(r, 10));
    const ws = mockWsInstance._ws;

    ws.onerror!(new Event("error"));

    await expect(connectPromise).rejects.toThrow("Cannot connect to engine");
  });
});
