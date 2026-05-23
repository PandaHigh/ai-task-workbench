import type { RpcRequest, RpcResponse, RpcNotification } from "@ai-workbench/shared";

const ENGINE_URL = "ws://localhost:9731";

type NotificationHandler = (method: string, params: Record<string, unknown>) => void;

class EngineClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
  private notificationHandlers: Set<NotificationHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.ws = new WebSocket(ENGINE_URL);

      this.ws.onopen = () => {
        this.connected = true;
        resolve();
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);

        if ("method" in msg && !("id" in msg)) {
          this.handleNotification(msg as RpcNotification);
        } else if ("id" in msg) {
          this.handleResponse(msg as RpcResponse);
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

  call(method: string, params?: Record<string, unknown>): Promise<unknown> {
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
      }, 30000);
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
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, 3000);
  }
}

export const engineClient = new EngineClient();
