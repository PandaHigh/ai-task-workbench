import type {
  ExecutionRun,
  TaskDefinition,
  GitCommit,
  LessonLearned,
} from "@ai-workbench/shared";

const TIMEOUT_MS = 15_000;

async function remoteFetch(baseUrl: string, path: string): Promise<Response> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Remote request failed: ${res.status} ${url}`);
  }
  return res;
}

async function remotePost(baseUrl: string, path: string, body: Record<string, unknown>): Promise<Response> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Remote write failed: ${res.status} ${url} ${text}`);
  }
  return res;
}

// ─── Read operations ────────────────────────────────────────────────────

export async function fetchRemoteRun(baseUrl: string, token: string): Promise<ExecutionRun> {
  const res = await remoteFetch(baseUrl, `/api/share/${token}/run`);
  return res.json() as Promise<ExecutionRun>;
}

export async function fetchRemoteTasks(baseUrl: string, token: string): Promise<TaskDefinition[]> {
  const res = await remoteFetch(baseUrl, `/api/share/${token}/tasks`);
  return res.json() as Promise<TaskDefinition[]>;
}

export async function fetchRemoteCommits(baseUrl: string, token: string): Promise<GitCommit[]> {
  const res = await remoteFetch(baseUrl, `/api/share/${token}/commits`);
  return res.json() as Promise<GitCommit[]>;
}

export async function fetchRemoteLessons(baseUrl: string, token: string): Promise<LessonLearned[]> {
  const res = await remoteFetch(baseUrl, `/api/share/${token}/lessons`);
  return res.json() as Promise<LessonLearned[]>;
}

export async function fetchRemoteQueue(baseUrl: string, token: string): Promise<TaskDefinition[]> {
  const res = await remoteFetch(baseUrl, `/api/share/${token}/queue`);
  return res.json() as Promise<TaskDefinition[]>;
}

export async function fetchRemoteReport(baseUrl: string, token: string): Promise<{ report: string; generatedAt: number } | null> {
  const res = await remoteFetch(baseUrl, `/api/share/${token}/report`);
  return res.json() as Promise<{ report: string; generatedAt: number } | null>;
}

export async function fetchRemoteLogs(baseUrl: string, token: string): Promise<Array<{ id: number; timestamp: number; level: string; source: string; message: string }>> {
  const res = await remoteFetch(baseUrl, `/api/share/${token}/logs`);
  return res.json() as Promise<Array<{ id: number; timestamp: number; level: string; source: string; message: string }>>;
}

// ─── Write operations ───────────────────────────────────────────────────

export async function remoteTaskCreate(
  baseUrl: string, token: string, params: { content: string; type: string; priority?: number; timeoutMinutes?: number }
): Promise<TaskDefinition> {
  const res = await remotePost(baseUrl, `/api/share/${token}/task.create`, params as Record<string, unknown>);
  return res.json() as Promise<TaskDefinition>;
}

export async function remoteTaskStart(baseUrl: string, token: string, taskId: string): Promise<void> {
  await remotePost(baseUrl, `/api/share/${token}/task.start`, { taskId });
}

export async function remoteTaskRetry(baseUrl: string, token: string, taskId: string): Promise<void> {
  await remotePost(baseUrl, `/api/share/${token}/task.retry`, { taskId });
}

export async function remoteTaskPause(baseUrl: string, token: string, taskId: string): Promise<void> {
  await remotePost(baseUrl, `/api/share/${token}/task.pause`, { taskId });
}

export async function remoteTaskCancel(baseUrl: string, token: string, taskId: string): Promise<void> {
  await remotePost(baseUrl, `/api/share/${token}/task.cancel`, { taskId });
}

export async function remoteRunStop(baseUrl: string, token: string): Promise<void> {
  await remotePost(baseUrl, `/api/share/${token}/run.stop`, {});
}

export async function remoteQueueReorder(baseUrl: string, token: string, taskIds: string[]): Promise<void> {
  await remotePost(baseUrl, `/api/share/${token}/queue.reorder`, { taskIds });
}

export async function remoteTaskSetTimeout(baseUrl: string, token: string, taskId: string, minutes: number): Promise<void> {
  await remotePost(baseUrl, `/api/share/${token}/task.setTimeout`, { taskId, minutes });
}
