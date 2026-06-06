import type { ExecutionRun, TaskDefinition, GitCommit, LessonLearned } from "@ai-workbench/shared";
import { ENGINE_HTTP_URL, ENGINE_WS_URL } from "./platform";

export interface ShareInitialData {
  authenticated: boolean;
  run: ExecutionRun;
  tasks: TaskDefinition[];
  queue: TaskDefinition[];
}

export class ShareClient {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null = null;

  constructor() {
    this.baseUrl = `${ENGINE_HTTP_URL}/api/share`;
  }

  private tokenUrl(token: string, resource: string): string {
    return `${this.baseUrl}/${token}/${resource}`;
  }

  async getRun(token: string): Promise<ExecutionRun> {
    const res = await fetch(this.tokenUrl(token, "run"));
    if (!res.ok) throw new Error(await this.extractError(res));
    return res.json();
  }

  async getTasks(token: string): Promise<TaskDefinition[]> {
    const res = await fetch(this.tokenUrl(token, "tasks"));
    if (!res.ok) throw new Error(await this.extractError(res));
    return res.json();
  }

  async getCommits(token: string): Promise<GitCommit[]> {
    const res = await fetch(this.tokenUrl(token, "commits"));
    if (!res.ok) throw new Error(await this.extractError(res));
    return res.json();
  }

  async getLessons(token: string): Promise<LessonLearned[]> {
    const res = await fetch(this.tokenUrl(token, "lessons"));
    if (!res.ok) throw new Error(await this.extractError(res));
    return res.json();
  }

  async getLogs(
    token: string,
  ): Promise<Array<{ id: number; timestamp: number; level: string; source: string; message: string }>> {
    const res = await fetch(this.tokenUrl(token, "logs"));
    if (!res.ok) throw new Error(await this.extractError(res));
    return res.json();
  }

  async getQueue(token: string): Promise<TaskDefinition[]> {
    const res = await fetch(this.tokenUrl(token, "queue"));
    if (!res.ok) throw new Error(await this.extractError(res));
    const data = await res.json();
    return data.queue || [];
  }

  async getReport(token: string): Promise<{ report: string; generatedAt: number } | null> {
    const res = await fetch(this.tokenUrl(token, "report"));
    if (!res.ok) throw new Error(await this.extractError(res));
    return res.json();
  }

  // Write operations
  async createTask(
    token: string,
    params: { content: string; type?: string; priority?: number; timeoutMinutes?: number },
  ): Promise<TaskDefinition> {
    const res = await fetch(this.tokenUrl(token, "task.create"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(await this.extractError(res));
    return res.json();
  }

  async startTask(token: string, taskId: string): Promise<void> {
    const res = await fetch(this.tokenUrl(token, "task.start"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
    if (!res.ok) throw new Error(await this.extractError(res));
  }

  async retryTask(token: string, taskId: string): Promise<void> {
    const res = await fetch(this.tokenUrl(token, "task.retry"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
    if (!res.ok) throw new Error(await this.extractError(res));
  }

  async stopRun(token: string): Promise<void> {
    const res = await fetch(this.tokenUrl(token, "run.stop"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(await this.extractError(res));
  }

  async reorderQueue(token: string, taskIds: string[]): Promise<void> {
    const res = await fetch(this.tokenUrl(token, "queue.reorder"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds }),
    });
    if (!res.ok) throw new Error(await this.extractError(res));
  }

  async setTaskTimeout(token: string, taskId: string, minutes: number): Promise<void> {
    const res = await fetch(this.tokenUrl(token, "task.setTimeout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, minutes }),
    });
    if (!res.ok) throw new Error(await this.extractError(res));
  }

  async updateTask(
    token: string,
    taskId: string,
    updates: { content?: string; priority?: number; timeoutMinutes?: number },
  ): Promise<TaskDefinition> {
    const res = await fetch(this.tokenUrl(token, "task.update"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, ...updates }),
    });
    if (!res.ok) throw new Error(await this.extractError(res));
    return res.json();
  }

  async removeTask(token: string, taskId: string): Promise<{ taskId: string; removed: boolean }> {
    const res = await fetch(this.tokenUrl(token, "queue.remove"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });
    if (!res.ok) throw new Error(await this.extractError(res));
    return res.json();
  }

  private async extractError(res: Response): Promise<string> {
    try {
      const data = await res.json();
      return data.error || `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }

  // ─── WebSocket ──────────────────────────────────────────────────────────

  connectWebSocket(token: string): Promise<ShareInitialData> {
    return new Promise((resolve, reject) => {
      const wsUrl = ENGINE_WS_URL;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.close();
        if (this.ws === ws) this.ws = null;
        reject(new Error("WebSocket connection timeout"));
      }, 10000);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "share.authenticate",
            params: { token },
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id === 1) {
            clearTimeout(timeout);
            if (msg.error) {
              ws.close();
              if (this.ws === ws) this.ws = null;
              reject(new Error(msg.error.message || "Authentication failed"));
              return;
            }
            resolve(msg.result as ShareInitialData);
            return;
          }
          if (msg.method && this.notificationHandler) {
            this.notificationHandler(msg.method, msg.params || {});
          }
        } catch {
          /* ignore parse errors */
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        if (this.ws === ws) this.ws = null;
        reject(new Error("WebSocket connection failed"));
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        if (this.ws === ws) this.ws = null;
      };
    });
  }

  onNotification(handler: (method: string, params: Record<string, unknown>) => void): void {
    this.notificationHandler = handler;
  }

  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.notificationHandler = null;
  }

  get wsConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
