import { WebSocketServer, WebSocket, type Data } from "ws";
import type { RpcRequest, RpcResponse, RpcNotification } from "@ai-workbench/shared";
import { RPC_ERRORS } from "@ai-workbench/shared";
import { methodHandlers } from "./json-rpc/methods.js";

const PORT = 9731;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class WsServer {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.wss = new WebSocketServer({ port: PORT });
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
      (ws as any)._isAlive = true;

      ws.on("message", (data: Data) => {
        this.handleMessage(ws, data.toString());
      });

      ws.on("pong", () => {
        (ws as any)._isAlive = true;
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
        if (!(client as any)._isAlive) {
          dead.push(client);
        } else if (client.readyState === WebSocket.OPEN) {
          (client as any)._isAlive = false;
          client.ping();
        }
      }
      for (const d of dead) {
        console.warn("[ws] terminating dead connection (no pong received)");
        d.terminate();
        this.clients.delete(d);
      }
    }, 30000);

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
        } catch {
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
    } catch {
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
      } catch {
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
