import { WebSocketServer, WebSocket, type Data } from "ws";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "http";
import type { RpcRequest, RpcResponse, RpcNotification } from "@ai-workbench/shared";
import { RPC_ERRORS } from "@ai-workbench/shared";
import { methodHandlers, RpcValidationError, skillManager } from "./json-rpc/methods.js";
import type { ShareStore } from "./db/share-store.js";
import type { Store } from "./db/store.js";
import type { QueueManager } from "./engine/queue-manager.js";
import { SessionManager } from "./engine/session-manager.js";

const PORT = 9731;
const HOST = process.env.ENGINE_HOST || "0.0.0.0";
const HEARTBEAT_INTERVAL_MS = 30000;

export class WsServer {
  private httpServer: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private clientAlive: WeakMap<WebSocket, boolean> = new WeakMap();
  private wsSessions: WeakMap<WebSocket, string> = new WeakMap();
  private shareClients: Map<WebSocket, { token: string; runId: string }> = new Map();
  private sessionManager: SessionManager;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatIntervalMs: number;
  private store: Store;
  private shareStore: ShareStore;
  private queueManager: QueueManager;

  constructor(deps: {
    store: Store;
    shareStore: ShareStore;
    queueManager: QueueManager;
    heartbeatIntervalMs?: number;
  }) {
    this.store = deps.store;
    this.shareStore = deps.shareStore;
    this.queueManager = deps.queueManager;
    this.heartbeatIntervalMs = deps.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.sessionManager = new SessionManager(this.store);
    this.httpServer = createServer(this.handleHttpRequest.bind(this));
    this.wss = new WebSocketServer({ server: this.httpServer });
  }

  start(): void {
    this.httpServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(`[engine] Port ${PORT} is already in use. Another engine instance may be running.`);
        process.exit(1);
      }
      console.error(`[engine] Server error: ${err.message}`);
    });

    this.wss.on("error", (err: NodeJS.ErrnoException) => {
      console.error(`[engine] WebSocket server error: ${err.message}`);
    });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      this.clientAlive.set(ws, true);

      // Auto-create anonymous session
      const session = this.sessionManager.identify({});
      this.wsSessions.set(ws, session.sessionId);

      ws.on("pong", () => {
        this.clientAlive.set(ws, true);
      });

      ws.on("message", (data: Data) => {
        this.handleMessage(ws, data.toString());
      });

      ws.on("close", () => {
        const sessionId = this.wsSessions.get(ws);
        if (sessionId) {
          const s = this.sessionManager.getBySessionId(sessionId);
          if (s) {
            this.broadcast("presence.left", { sessionId, userId: s.userId, displayName: s.displayName });
          }
          this.sessionManager.removeSession(sessionId);
        }
        this.clients.delete(ws);
        this.shareClients.delete(ws);
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

    this.httpServer.listen(PORT, HOST, () => {
      console.log(`[engine] Server listening on http://${HOST}:${PORT}`);
    });

    this.shareStore.cleanup();
  }

  getSessionManager(): SessionManager {
    return this.sessionManager;
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

    // Share clients: only send if runId matches
    const runId = params.runId as string | undefined;
    const staleShare: WebSocket[] = [];
    for (const [client, info] of this.shareClients) {
      if (runId && info.runId !== runId) continue;
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch {
          staleShare.push(client);
        }
      }
    }
    for (const s of staleShare) this.shareClients.delete(s);
  }

  // ─── HTTP Request Handler ──────────────────────────────────────────────

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || "/";
    const method = req.method || "GET";

    // Health check
    if (url === "/api/health" && method === "GET") {
      this.setCorsHeaders(req, res);
      this.sendJson(res, 200, { status: "ok", uptime: process.uptime() });
      return;
    }

    // CORS preflight
    if (method === "OPTIONS") {
      this.setCorsHeaders(req, res);
      res.writeHead(204);
      res.end();
      return;
    }

    // Share API
    if (url.startsWith("/api/share/")) {
      this.setCorsHeaders(req, res);
      this.handleShareApi(req, res, url, method);
      return;
    }

    // Skill upload API
    if (url === "/api/skills/upload" && method === "POST") {
      this.setCorsHeaders(req, res);
      skillManager.handleUpload(req, res);
      return;
    }

    // Non-API paths: in production serve static files, in dev proxy to Vite
    this.serveFrontend(req, res, url);
  }

  private setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (origin) {
      const { host } = new URL(origin);
      if (host === "localhost:9731" || host === "127.0.0.1:9731" || host.startsWith("localhost:") || host.startsWith("127.0.0.1:")) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      }
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  private handleShareApi(req: IncomingMessage, res: ServerResponse, url: string, method: string): void {
    const parts = url.replace("/api/share/", "").split("/");
    const token = parts[0];
    const resource = parts[1] || "run";

    if (!token) {
      this.sendJson(res, 400, { error: "Missing share token" });
      return;
    }

    const share = this.shareStore.getByToken(token);
    if (!share) {
      this.sendJson(res, 404, { error: "Share not found or expired" });
      return;
    }

    const runId = share.runId;

    if (method === "GET") {
      this.handleShareGet(res, runId, resource);
    } else if (method === "POST") {
      this.handleSharePost(req, res, runId, resource);
    } else {
      this.sendJson(res, 405, { error: "Method not allowed" });
    }
  }

  private handleShareGet(res: ServerResponse, runId: string, resource: string): void {
    try {
      switch (resource) {
        case "run": {
          const run = this.store.getRun(runId);
          if (!run) { this.sendJson(res, 404, { error: "Run not found" }); return; }
          const { workingDir: _, ...safe } = run;
          this.sendJson(res, 200, safe);
          break;
        }
        case "tasks":
          this.sendJson(res, 200, this.store.listTasks(runId));
          break;
        case "commits":
          this.sendJson(res, 200, this.store.getCommits(runId));
          break;
        case "lessons":
          this.sendJson(res, 200, this.store.getLessons(runId));
          break;
        case "queue":
          this.sendJson(res, 200, { runId, queue: this.queueManager.list(runId) });
          break;
        case "report":
          this.sendJson(res, 200, this.store.getReport(runId));
          break;
        case "logs":
          this.sendJson(res, 200, this.store.getLogs(runId));
          break;
        default:
          this.sendJson(res, 404, { error: `Unknown resource: ${resource}` });
      }
    } catch (err) {
      this.sendJson(res, 500, { error: err instanceof Error ? err.message : "Internal error" });
    }
  }

  private handleSharePost(req: IncomingMessage, res: ServerResponse, runId: string, resource: string): void {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const params = body ? JSON.parse(body) : {};
        switch (resource) {
          case "task.create": {
            if (!params.content) { this.sendJson(res, 400, { error: "Missing content" }); return; }
            const task = this.queueManager.enqueue(runId, {
              content: params.content,
              type: params.type ?? "user_defined",
              ...(params.priority !== undefined && { priority: Number(params.priority) }),
              ...(params.timeoutMinutes !== undefined && { timeoutMinutes: Number(params.timeoutMinutes) }),
            });
            this.store.saveTask(runId, task);
            this.broadcast("queue.updated", { runId, queue: this.queueManager.list(runId) });
            this.sendJson(res, 200, task);
            break;
          }
          case "task.start": {
            // For remote share: just update status, actual execution runs on the owner's engine
            this.sendJson(res, 200, { status: "accepted" });
            break;
          }
          case "task.retry": {
            if (!params.taskId) { this.sendJson(res, 400, { error: "Missing taskId" }); return; }
            const tasks = this.store.listTasks(runId);
            const task = tasks.find((t: { id: string }) => t.id === params.taskId);
            if (!task) { this.sendJson(res, 404, { error: "Task not found" }); return; }
            const resetTask = {
              ...task,
              status: "pending" as const, score: undefined, scoreDetails: undefined,
              result: undefined, errorMessage: undefined, completedAt: undefined,
              durationMs: undefined, costUsd: undefined,
            };
            this.store.updateTask(runId, params.taskId, resetTask);
            this.queueManager.restore(runId, resetTask);
            this.broadcast("queue.updated", { runId, queue: this.queueManager.list(runId) });
            this.sendJson(res, 200, { taskId: params.taskId });
            break;
          }
          case "task.pause":
          case "task.cancel":
            this.sendJson(res, 200, { status: "accepted" });
            break;
          case "run.stop":
            this.sendJson(res, 200, { status: "accepted" });
            break;
          case "queue.reorder": {
            if (!Array.isArray(params.taskIds)) { this.sendJson(res, 400, { error: "Missing taskIds" }); return; }
            this.queueManager.reorder(runId, params.taskIds);
            this.broadcast("queue.updated", { runId, queue: this.queueManager.list(runId) });
            this.sendJson(res, 200, { runId, order: params.taskIds });
            break;
          }
          case "task.setTimeout": {
            if (!params.taskId || typeof params.minutes !== "number") {
              this.sendJson(res, 400, { error: "Missing taskId or minutes" }); return;
            }
            this.store.updateTask(runId, params.taskId, { timeoutMinutes: params.minutes });
            this.sendJson(res, 200, { taskId: params.taskId, timeoutMinutes: params.minutes });
            break;
          }
          default:
            this.sendJson(res, 404, { error: `Unknown resource: ${resource}` });
        }
      } catch (err) {
        this.sendJson(res, 500, { error: err instanceof Error ? err.message : "Internal error" });
      }
    });
  }

  private serveFrontend(req: IncomingMessage, res: ServerResponse, url: string): void {
    // In dev mode, proxy to Vite dev server so the browser stays on port 9731
    if (process.env.NODE_ENV !== "production") {
      const proxyReq = httpRequest({
        hostname: "localhost",
        port: 1420,
        path: url,
        method: req.method,
        headers: { ...req.headers, host: "localhost:1420" },
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on("error", () => {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Vite dev server not available");
      });
      req.pipe(proxyReq);
      return;
    }
    // In production, serve built frontend files
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!DOCTYPE html><html><body><h1>AI Task Workbench</h1><p>Frontend not built. Run: npm run build</p></body></html>");
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  // ─── WebSocket Message Handler ─────────────────────────────────────────

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

    // Share token authentication — handled before methodHandlers
    if (req.method === "share.authenticate") {
      const token = req.params?.token as string;
      if (!token) {
        this.send(ws, { jsonrpc: "2.0", id: req.id, error: { code: -32602, message: "Missing token" } });
        return;
      }
      const share = this.shareStore.getByToken(token);
      if (!share) {
        this.send(ws, { jsonrpc: "2.0", id: req.id, error: { code: -32602, message: "Invalid or expired share token" } });
        return;
      }
      this.shareClients.set(ws, { token, runId: share.runId });
      const run = this.store.getRun(share.runId);
      const { workingDir: _, ...safeRun } = run || {};
      this.send(ws, {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          authenticated: true,
          run: safeRun,
          tasks: this.store.listTasks(share.runId),
          queue: this.queueManager.list(share.runId),
        },
      });
      return;
    }

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
      if (err instanceof RpcValidationError) {
        this.send(ws, {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: RPC_ERRORS.INVALID_PARAMS.code, message: errMsg },
        });
      } else {
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
    for (const client of this.shareClients.keys()) {
      client.close();
    }
    this.shareClients.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    this.httpServer.close();
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
