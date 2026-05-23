import type { CreateRunParams, CreateTaskParams, ExecutionRun } from "@ai-workbench/shared";
import { Store } from "../db/store.js";
import { QueueManager } from "../engine/queue-manager.js";
import { Executor } from "../engine/executor.js";
import * as wizardHandler from "../wizard/wizard-handler.js";

const store = new Store();
const queueManager = new QueueManager();
const activeExecutors = new Map<string, Executor>();

type NotifyFn = (method: string, params: Record<string, unknown>) => void;
let notify: NotifyFn = () => {};

export function setNotifyFn(fn: NotifyFn): void {
  notify = fn;
}

export function shutdown(): void {
  for (const [runId, executor] of activeExecutors) {
    executor.stop();
    activeExecutors.delete(runId);
  }
}

type MethodHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

export const methodHandlers: Record<string, MethodHandler> = {
  "run.list": async () => {
    return store.listRuns();
  },

  "run.create": async (params) => {
    const p = params as unknown as CreateRunParams;
    const run: ExecutionRun = {
      id: crypto.randomUUID(),
      workingDir: p.workingDir,
      goals: p.goals,
      terminationConditions: p.terminationConditions,
      status: "idle",
      totalCostUsd: 0,
      totalTasksCompleted: 0,
    };
    store.saveRun(run);

    if (p.tasks) {
      for (const t of p.tasks) {
        const task = queueManager.enqueue(run.id, t);
        store.saveTask(run.id, task);
      }
    }

    return run;
  },

  "run.report": async (params) => {
    const { runId } = params as { runId: string };
    const run = store.getRun(runId);
    const report = store.getReport(runId);
    return { run, report };
  },

  "run.tasks": async (params) => {
    const { runId } = params as { runId: string };
    return store.listTasks(runId);
  },

  "run.commits": async (params) => {
    const { runId } = params as { runId: string };
    return store.getCommits(runId);
  },

  "run.lessons": async (params) => {
    const { runId } = params as { runId: string };
    return store.getLessons(runId);
  },

  "run.stop": async (params) => {
    const { runId } = params as { runId: string };
    const executor = activeExecutors.get(runId);
    if (executor) {
      executor.stop();
      activeExecutors.delete(runId);
    }
    const run = store.getRun(runId);
    if (run) {
      run.status = "paused";
      store.saveRun(run);
    }
    return { status: "stopped" };
  },

  "run.delete": async (params) => {
    const { runId } = params as { runId: string };
    const executor = activeExecutors.get(runId);
    if (executor) {
      executor.stop();
      activeExecutors.delete(runId);
    }
    queueManager.clear(runId);
    store.deleteRun(runId);
    return { deleted: true };
  },

  "task.create": async (params) => {
    const p = params as unknown as CreateTaskParams & { runId: string };
    if (!p.runId || !store.getRun(p.runId)) {
      throw new Error(`Run not found: ${p.runId || "missing"}`);
    }
    if (!p.content?.trim()) {
      throw new Error("Task content is required");
    }
    const task = queueManager.enqueue(p.runId, p);
    store.saveTask(p.runId, task);
    return task;
  },

  "task.start": async (params) => {
    const { runId } = params as { runId: string };
    const run = store.getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    if (run.status === "completed" || run.status === "failed") {
      throw new Error(`Run ${runId} is already ${run.status} and cannot be restarted`);
    }

    if (activeExecutors.has(runId)) {
      throw new Error(`Run ${runId} already has an active executor`);
    }

    // Reload pending tasks into queue from store
    const pendingTasks = store.listTasks(runId).filter((t) => t.status === "pending");
    for (const t of pendingTasks) {
      if (!queueManager.list(runId).some((q) => q.id === t.id)) {
        queueManager.restore(runId, t);
      }
    }

    run.status = "running";
    run.startedAt = Date.now();
    store.saveRun(run);

    const executor = new Executor(queueManager, notify, runId);
    activeExecutors.set(runId, executor);

    executor.start(run).finally(() => {
      activeExecutors.delete(runId);
    });

    return { status: "running" };
  },

  "task.pause": async (params) => {
    const { runId } = params as { runId: string };
    const executor = activeExecutors.get(runId);
    if (executor) {
      executor.stop();
      activeExecutors.delete(runId);
    }
    const run = store.getRun(runId);
    if (run) {
      run.status = "paused";
      store.saveRun(run);
    }
    return { status: "paused" };
  },

  "task.resume": async (params) => {
    const { runId } = params as { runId: string };
    const run = store.getRun(runId);
    if (run && run.status === "paused") {
      const pendingTasks = store.listTasks(runId).filter((t) => t.status === "pending");
      for (const t of pendingTasks) {
        if (!queueManager.list(runId).some((q) => q.id === t.id)) {
          queueManager.restore(runId, t);
        }
      }
      run.status = "running";
      store.saveRun(run);
      const executor = new Executor(queueManager, notify, runId);
      activeExecutors.set(runId, executor);
      executor.start(run).finally(() => {
        activeExecutors.delete(runId);
      });
    }
    return { status: "running" };
  },

  "task.cancel": async (params) => {
    const { taskId, runId } = params as { taskId: string; runId: string };
    const executor = activeExecutors.get(runId);
    if (executor) {
      executor.cancelTask(taskId, runId);
    }
    return { status: "cancelled" };
  },

  "task.setTimeout": async (params) => {
    const { taskId, runId, minutes } = params as { taskId: string; runId: string; minutes: number };
    if (!minutes || minutes < 1 || minutes > 1440) {
      throw new Error("Timeout must be between 1 and 1440 minutes");
    }
    store.updateTask(runId, taskId, { timeoutMinutes: minutes });
    return { taskId, timeoutMinutes: minutes };
  },

  "queue.list": async (params) => {
    const { runId } = params as { runId: string };
    return { runId, queue: queueManager.list(runId) };
  },

  "queue.reorder": async (params) => {
    const { runId, taskIds } = params as { runId: string; taskIds: string[] };
    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      throw new Error("taskIds must be a non-empty array");
    }
    queueManager.reorder(runId, taskIds);
    return { runId, order: taskIds };
  },

  "wizard.start": async (params) => {
    const { workingDir } = params as { workingDir: string };
    const session = wizardHandler.startSession(workingDir);
    return { sessionId: session.sessionId, workingDir: session.workingDir };
  },

  "wizard.chat": async (params) => {
    const { sessionId, message } = params as { sessionId: string; message: string };
    const result = await wizardHandler.chat(sessionId, message);
    return { sessionId, response: result.response, shouldExtractParams: result.shouldExtractParams };
  },

  "wizard.validate": async (params) => {
    const { sessionId } = params as { sessionId: string };
    const extracted = wizardHandler.extractParams(sessionId);
    const validation = wizardHandler.validateParams(extracted);
    return { sessionId, valid: validation.valid, errors: validation.errors, params: extracted };
  },

  "config.get": async (params) => {
    const { key } = params as { key: string };
    return { key, value: store.getConfig(key) };
  },

  "config.set": async (params) => {
    const { key, value } = params as { key: string; value: unknown };
    store.setConfig(key, value);
    return { key, value, saved: true };
  },
};
