import type { RpcRequest, RpcResponse, RpcNotification } from "@ai-workbench/shared";
import { ENGINE_WS_URL } from "./platform";

type NotificationHandler = (method: string, params: Record<string, unknown>) => void;

class EngineClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
  private notificationHandlers: Set<NotificationHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectDelay = 30000;
  private connected = false;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
        if (this.ws!.readyState === WebSocket.OPEN) resolve();
        else this.ws!.onopen = () => { this.connected = true; this.reconnectAttempts = 0; resolve(); };
        return;
      }

      this.ws = new WebSocket(ENGINE_WS_URL);

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onmessage = (event) => {
        let msg: unknown;
        try {
          msg = JSON.parse(event.data as string);
        } catch (parseErr) {
          console.warn("[engine-client] received non-JSON message:", parseErr instanceof Error ? parseErr.message : parseErr);
          return;
        }

        if (typeof msg === "object" && msg !== null) {
          if ("method" in msg && !("id" in msg)) {
            this.handleNotification(msg as RpcNotification);
          } else if ("id" in msg) {
            this.handleResponse(msg as RpcResponse);
          }
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.pending.forEach((p) => p.reject(new Error("Connection closed")));
        this.pending.clear();
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        if (!this.connected) reject(new Error("Cannot connect to engine"));
      };
    });
  }

  call(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Engine not connected"));
        return;
      }

      const id = ++this.requestId;
      const request: RpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params: params || {},
      };

      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(request));

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout calling ${method}`));
        }
      }, timeoutMs ?? 30000);
    });
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private handleResponse(msg: RpcResponse): void {
    const pending = this.pending.get(msg.id as number);
    if (!pending) return;

    this.pending.delete(msg.id as number);
    if (msg.error) {
      pending.reject(new Error(msg.error.message));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleNotification(msg: RpcNotification): void {
    for (const handler of this.notificationHandlers) {
      handler(msg.method, msg.params || {});
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000, this.maxReconnectDelay);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => { console.warn("[engine-client] reconnect failed:", err instanceof Error ? err.message : err); });
    }, delay);
  }
}

export const engineClient = new EngineClient();
