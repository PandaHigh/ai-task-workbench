import { WebSocketServer, WebSocket, type Data } from "ws";
import type { RpcRequest, RpcResponse, RpcNotification } from "@ai-workbench/shared";
import { RPC_ERRORS } from "@ai-workbench/shared";
import { methodHandlers } from "./json-rpc/methods.js";

const PORT = 9731;
const HEARTBEAT_INTERVAL_MS = 30000;

export class WsServer {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private clientAlive: WeakMap<WebSocket, boolean> = new WeakMap();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatIntervalMs: number;

  constructor(options?: { heartbeatIntervalMs?: number }) {
    this.wss = new WebSocketServer({ port: PORT });
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  }

  start(): void {
    this.wss.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(`[engine] Port ${PORT} is already in use. Another engine instance may be running.`);
        process.exit(1);
      }
      console.error(`[engine] WebSocket server error: ${err.message}`);
    });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      this.clientAlive.set(ws, true);

      ws.on("pong", () => {
        this.clientAlive.set(ws, true);
      });

      ws.on("message", (data: Data) => {
        this.handleMessage(ws, data.toString());
      });

      ws.on("close", () => {
        this.clients.delete(ws);
      });

      ws.on("error", (err) => {
        console.error(`[ws] client error: ${err.message}`);
        this.clients.delete(ws);
      });

      this.send(ws, {
        jsonrpc: "2.0",
        method: "system.ready",
        params: { port: PORT },
      });
    });

    // Heartbeat: detect half-open connections every 30s
    this.heartbeatTimer = setInterval(() => {
      const dead: WebSocket[] = [];
      for (const client of this.clients) {
        if (!this.clientAlive.get(client)) {
          dead.push(client);
        } else if (client.readyState === WebSocket.OPEN) {
          this.clientAlive.set(client, false);
          client.ping();
        }
      }
      for (const d of dead) {
        console.warn("[ws] terminating dead connection (no pong received)");
        d.terminate();
        this.clients.delete(d);
      }
    }, this.heartbeatIntervalMs);

    console.log(`[engine] WebSocket server listening on ws://localhost:${PORT}`);
  }

  broadcast(method: string, params: Record<string, unknown>): void {
    const notification: RpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    const data = JSON.stringify(notification);
    const stale: WebSocket[] = [];
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (sendErr) {
          console.warn("[ws] failed to send to client, removing:", sendErr instanceof Error ? sendErr.message : sendErr);
          stale.push(client);
        }
      }
    }
    for (const s of stale) this.clients.delete(s);
  }

  private async handleMessage(ws: WebSocket, raw: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch (parseErr) {
      console.warn("[ws] received non-JSON message from client:", parseErr instanceof Error ? parseErr.message : String(parseErr));
      this.send(ws, { jsonrpc: "2.0", id: 0, error: RPC_ERRORS.PARSE_ERROR });
      return;
    }

    if (!this.isValidRequest(message)) {
      this.send(ws, { jsonrpc: "2.0", id: 0, error: RPC_ERRORS.INVALID_REQUEST });
      return;
    }

    const req = message as RpcRequest;
    const handler = methodHandlers[req.method];

    if (!handler) {
      this.send(ws, {
        jsonrpc: "2.0",
        id: req.id,
        error: RPC_ERRORS.METHOD_NOT_FOUND,
      });
      return;
    }

    try {
      const result = await handler(req.params || {});
      this.send(ws, { jsonrpc: "2.0", id: req.id, result });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[rpc] ${req.method} failed: ${errMsg}`);
      this.send(ws, {
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: RPC_ERRORS.INTERNAL_ERROR.code,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  private send(ws: WebSocket, message: RpcResponse | RpcNotification): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (sendErr) {
        console.warn("[ws] failed to send response to client, removing:", sendErr instanceof Error ? sendErr.message : sendErr);
        this.clients.delete(ws);
      }
    }
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private isValidRequest(msg: unknown): msg is RpcRequest {
    return (
      typeof msg === "object" &&
      msg !== null &&
      (msg as Record<string, unknown>).jsonrpc === "2.0" &&
      typeof (msg as Record<string, unknown>).method === "string"
    );
  }
}
