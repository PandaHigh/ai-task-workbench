import type { ExecutionRun, TaskDefinition, GitCommit, LessonLearned } from "@ai-workbench/shared";

export class ShareClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${window.location.origin}/api/share`;
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

  async getLogs(token: string): Promise<Array<{ id: number; timestamp: number; level: string; source: string; message: string }>> {
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
  async createTask(token: string, params: { content: string; type?: string; priority?: number; timeoutMinutes?: number }): Promise<TaskDefinition> {
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

  private async extractError(res: Response): Promise<string> {
    try {
      const data = await res.json();
      return data.error || `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  }
}
