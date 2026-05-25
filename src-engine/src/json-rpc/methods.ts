import type { CreateRunParams, ExecutionRun } from "@ai-workbench/shared";
import { Store } from "../db/store.js";
import { QueueManager } from "../engine/queue-manager.js";
import { Executor } from "../engine/executor.js";
import * as wizardHandler from "../wizard/wizard-handler.js";
import { resolve, normalize } from "path";
import { homedir, tmpdir } from "os";

const store = new Store();
const queueManager = new QueueManager();
const activeExecutors = new Map<string, Executor>();

// ─── Validation helpers ────────────────────────────────────────────────

export class RpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcValidationError";
  }
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (value === undefined || value === null) {
    throw new RpcValidationError(`Missing required parameter: ${key}`);
  }
  if (typeof value !== "string") {
    throw new RpcValidationError(`Parameter '${key}' must be a string, got ${typeof value}`);
  }
  return value;
}

function requireNonEmptyString(params: Record<string, unknown>, key: string): string {
  const value = requireString(params, key);
  if (value.trim().length === 0) {
    throw new RpcValidationError(`Parameter '${key}' must be a non-empty string`);
  }
  return value;
}

function validateRunId(runId: string): void {
  if (runId.includes("..") || runId.includes("/") || runId.includes("\\")) {
    throw new RpcValidationError("runId contains invalid path characters");
  }
}

// ─── Working dir validation ────────────────────────────────────────────

const SYSTEM_DIRS = [
  "/etc", "/usr", "/bin", "/sbin", "/var", "/sys", "/proc", "/dev",
  "/boot", "/lib", "/lib64", "/snap", "/nix",
  "/System", "/Library", "/Applications",
  "C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)",
  "C:\\ProgramData",
].map((d) => normalize(d.toLowerCase()));

function validateWorkingDir(dir: string): string {
  if (!dir || typeof dir !== "string") {
    throw new Error("workingDir is required and must be a string");
  }
  // Expand ~/ to home directory
  const expanded = dir.startsWith("~/") ? dir.replace("~", homedir()) : dir;
  const resolved = resolve(expanded);
  const normalizedLower = normalize(resolved.toLowerCase());

  for (const sysDir of SYSTEM_DIRS) {
    if (normalizedLower === sysDir || normalizedLower.startsWith(sysDir + "/") || normalizedLower.startsWith(sysDir + "\\")) {
      throw new Error(`workingDir cannot point to a system directory: ${resolved}`);
    }
  }

  const home = homedir().toLowerCase();
  const tmp = tmpdir().toLowerCase();
  if (normalizedLower === home || normalizedLower === tmp) {
    throw new Error(`workingDir cannot be the home or temp directory: ${resolved}`);
  }

  return resolved;
}

// ─── Config constraints ────────────────────────────────────────────────

const NUMERIC_CONFIG_CONSTRAINTS: Record<string, { min: number; max: number }> = {
  maxBudgetUsd: { min: 0, max: 10000 },
  maxEvaluationCycles: { min: 1, max: 10000 },
  stagnationWindow: { min: 2, max: 100 },
  qualityThreshold: { min: 0.1, max: 1.0 },
  maxTurns: { min: 1, max: 500 },
  maxAutoRetries: { min: 0, max: 10 },
  maxConcurrentTasks: { min: 1, max: 10 },
};

const ALLOWED_CONFIG_KEYS = new Set([
  "maxBudgetUsd",
  "maxEvaluationCycles",
  "stagnationWindow",
  "qualityThreshold",
  "maxTurns",
  "maxAutoRetries",
  "maxConcurrentTasks",
  "defaultModel",
]);

// ─── Notify / shutdown ─────────────────────────────────────────────────

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

export function recoverStaleRuns(): { runsReset: number; tasksReset: number } {
  let runsReset = 0;
  let tasksReset = 0;
  const transientStatuses = ["running", "scoring", "committing", "reverting"] as const;

  const runs = store.listRuns();
  for (const run of runs) {
    if (run.status === "running") {
      run.status = "paused";
      store.saveRun(run);
      runsReset++;
    }
    const tasks = store.listTasks(run.id);
    for (const task of tasks) {
      if (transientStatuses.includes(task.status as typeof transientStatuses[number])) {
        store.updateTask(run.id, task.id, {
          status: "pending",
          errorMessage: `Crash recovery: task was ${task.status} at engine restart`,
        });
        tasksReset++;
      }
    }
  }
  return { runsReset, tasksReset };
}

type MethodHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

// ─── Method handlers ───────────────────────────────────────────────────

export const methodHandlers: Record<string, MethodHandler> = {
  "run.list": async () => {
    return store.listRuns();
  },

  "run.create": async (params) => {
    const p = params as unknown as CreateRunParams;
    const safeWorkingDir = validateWorkingDir(
      requireNonEmptyString(params, "workingDir"),
    );
    if (!Array.isArray(p.goals) || p.goals.length === 0) {
      throw new RpcValidationError("Parameter 'goals' must be a non-empty array");
    }
    if (!Array.isArray(p.terminationConditions) || p.terminationConditions.length === 0) {
      throw new RpcValidationError("Parameter 'terminationConditions' must be a non-empty array");
    }
    const run: ExecutionRun = {
      id: crypto.randomUUID(),
      workingDir: safeWorkingDir,
      goals: p.goals,
      terminationConditions: p.terminationConditions,
      status: "idle",
      totalCostUsd: 0,
      totalTasksCompleted: 0,
    };
    store.saveRun(run);

    if (p.tasks) {
      if (!Array.isArray(p.tasks)) {
        throw new RpcValidationError("Parameter 'tasks' must be an array when provided");
      }
      for (const t of p.tasks) {
        const task = queueManager.enqueue(run.id, t);
        store.saveTask(run.id, task);
      }
    }

    return run;
  },

  "run.report": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const run = store.getRun(runId);
    const report = store.getReport(runId);
    return { run, report };
  },

  "run.tasks": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    return store.listTasks(runId);
  },

  "run.commits": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    return store.getCommits(runId);
  },

  "run.lessons": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    return store.getLessons(runId);
  },

  "run.stop": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
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
    const runId = requireString(params, "runId");
    validateRunId(runId);
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
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const content = requireNonEmptyString(params, "content");
    if (!store.getRun(runId)) {
      throw new RpcValidationError(`Run not found: ${runId}`);
    }
    const { type, priority, timeoutMinutes, promptJson } = params as Record<string, unknown>;
    const task = queueManager.enqueue(runId, {
      content,
      type: (type ?? "user_defined") as "user_defined" | "smart_task",
      ...(priority !== undefined && { priority: Number(priority) }),
      ...(timeoutMinutes !== undefined && { timeoutMinutes: Number(timeoutMinutes) }),
      ...(promptJson !== undefined && { promptJson: String(promptJson) }),
    });
    store.saveTask(runId, task);
    return task;
  },

  "task.start": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const run = store.getRun(runId);
    if (!run) throw new RpcValidationError(`Run ${runId} not found`);

    if (run.status === "completed" || run.status === "failed") {
      throw new RpcValidationError(`Run ${runId} is already ${run.status} and cannot be restarted`);
    }

    if (activeExecutors.has(runId)) {
      throw new RpcValidationError(`Run ${runId} already has an active executor`);
    }

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
    const runId = requireString(params, "runId");
    validateRunId(runId);
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
    const runId = requireString(params, "runId");
    validateRunId(runId);
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
    const runId = requireString(params, "runId");
    const taskId = requireString(params, "taskId");
    validateRunId(runId);
    const executor = activeExecutors.get(runId);
    if (executor) {
      executor.cancelTask(taskId, runId);
    }
    return { status: "cancelled" };
  },

  "task.retry": async (params) => {
    const runId = requireString(params, "runId");
    const taskId = requireString(params, "taskId");
    validateRunId(runId);
    const run = store.getRun(runId);
    if (!run) throw new RpcValidationError(`Run ${runId} not found`);
    const tasks = store.listTasks(runId);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new RpcValidationError(`Task ${taskId} not found`);
    if (task.status !== "failed" && task.status !== "reverted" && task.status !== "cancelled") {
      throw new RpcValidationError(`Task ${taskId} status '${task.status}' — can only retry failed/reverted/cancelled`);
    }
    store.updateTask(runId, taskId, {
      status: "pending", score: undefined, scoreDetails: undefined,
      result: undefined, errorMessage: undefined, completedAt: undefined,
      durationMs: undefined, costUsd: undefined,
    });
    const restored = queueManager.enqueue(runId, {
      content: task.content, type: task.type, priority: task.priority, timeoutMinutes: task.timeoutMinutes,
    });
    store.saveTask(runId, restored);
    if (run.status !== "running" && !activeExecutors.has(runId)) {
      run.status = "running";
      run.startedAt = run.startedAt || Date.now();
      store.saveRun(run);
      const ex = new Executor(queueManager, notify, runId);
      activeExecutors.set(runId, ex);
      ex.start(run).finally(() => { activeExecutors.delete(runId); });
    }
    return { taskId, status: "pending", newQueueTaskId: restored.id };
  },

  "task.setTimeout": async (params) => {
    const runId = requireString(params, "runId");
    const taskId = requireString(params, "taskId");
    validateRunId(runId);
    const { minutes } = params as { minutes: number };
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      throw new RpcValidationError("Timeout must be a finite number between 1 and 1440 minutes");
    }
    store.updateTask(runId, taskId, { timeoutMinutes: minutes });
    return { taskId, timeoutMinutes: minutes };
  },

  "queue.list": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    return { runId, queue: queueManager.list(runId) };
  },

  "queue.reorder": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const { taskIds } = params as { taskIds: unknown[] };
    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      throw new RpcValidationError("Parameter 'taskIds' must be a non-empty array");
    }
    for (let i = 0; i < taskIds.length; i++) {
      if (typeof taskIds[i] !== "string") {
        throw new RpcValidationError(`taskIds[${i}] must be a string`);
      }
    }
    queueManager.reorder(runId, taskIds as string[]);
    return { runId, order: taskIds };
  },

  "wizard.start": async (params) => {
    const workingDir = requireNonEmptyString(params, "workingDir");
    const safeWorkingDir = validateWorkingDir(workingDir);
    const session = wizardHandler.startSession(safeWorkingDir);
    return { sessionId: session.sessionId, workingDir: session.workingDir };
  },

  "wizard.chat": async (params) => {
    const sessionId = requireString(params, "sessionId");
    const message = requireNonEmptyString(params, "message");
    const result = await wizardHandler.chat(sessionId, message);
    return { sessionId, response: result.response, shouldExtractParams: result.shouldExtractParams };
  },

  "wizard.validate": async (params) => {
    const sessionId = requireString(params, "sessionId");
    const extracted = wizardHandler.extractParams(sessionId);
    const validation = wizardHandler.validateParams(extracted);
    return { sessionId, valid: validation.valid, errors: validation.errors, params: extracted };
  },

  "config.get": async (params) => {
    const key = requireString(params, "key");
    return { key, value: store.getConfig(key) };
  },

  "config.set": async (params) => {
    const key = requireString(params, "key");
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      throw new RpcValidationError(
        `Config key '${key}' is not allowed. Allowed keys: ${[...ALLOWED_CONFIG_KEYS].join(", ")}`,
      );
    }
    const { value } = params as { value: unknown };
    const constraints = NUMERIC_CONFIG_CONSTRAINTS[key];
    if (constraints) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new RpcValidationError(`config '${key}' must be a finite number, got: ${value}`);
      }
      if (value < constraints.min || value > constraints.max) {
        throw new RpcValidationError(`config '${key}' must be between ${constraints.min} and ${constraints.max}, got: ${value}`);
      }
    }
    store.setConfig(key, value);
    return { key, value, saved: true };
  },
};
