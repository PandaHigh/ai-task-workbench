import type { ExecutionRun } from "@ai-workbench/shared";
import { Store } from "../db/store.js";
import { ShareStore } from "../db/share-store.js";
import { SubscriptionStore } from "../db/subscription-store.js";
import { SkillStore } from "../db/skill-store.js";
import { SkillManager } from "../skills/skill-manager.js";
import { QueueManager } from "../engine/queue-manager.js";
import { Executor } from "../engine/omx-executor.js";
import { SessionManager } from "../engine/session-manager.js";
import * as wizardHandler from "../wizard/wizard-handler.js";

import { resolve, normalize, join } from "path";
import { homedir, tmpdir } from "os";
import { mkdirSync } from "fs";

import { serializeGoalState } from "../lib/goal-utils.js";
import { OMX_ROLES } from "../engine/omx-roles.js";
import { DEFAULT_CREW_CONFIG, type CrewMode, getBuiltInProfiles } from "../engine/builtin-profiles.js";
import { PluginRegistry, type McpServerConfig } from "../plugins/plugin-registry.js";

import { getDataDir } from "../db/store-utils.js";
import { log } from "../lib/logger.js";

const PORT = Number(process.env.ENGINE_PORT) || 9731;

const store = new Store();
const shareStore = new ShareStore();
const subscriptionStore = new SubscriptionStore();
const skillStore = new SkillStore();
const queueManager = new QueueManager();
let skillManager: SkillManager;

export { store, shareStore, subscriptionStore, queueManager, skillStore, skillManager };
const sessionManager = new SessionManager(store);
const activeExecutors = new Map<string, Executor>();
const pluginRegistry = new PluginRegistry(getDataDir());
export { pluginRegistry };

export { sessionManager };

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
  if (runId.includes("\0")) throw new RpcValidationError("Invalid runId");
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
  if (dir.includes("\0")) throw new RpcValidationError("Invalid directory path");
  // Expand ~/ to home directory (both / and \ variants for Windows)
  const homeDir = homedir();
  const expanded = dir.startsWith("~/") || dir.startsWith("~\\")
    ? homeDir + dir.slice(1)
    : dir === "~"
    ? homeDir
    : dir;
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

  mkdirSync(resolved, { recursive: true });

  return resolved;
}

// ─── Config constraints ────────────────────────────────────────────────

const NUMERIC_CONFIG_CONSTRAINTS: Record<string, { min: number; max: number }> = {
  maxBudgetUsd: { min: 0, max: Infinity },
  maxEvaluationCycles: { min: 1, max: 10000 },
  stagnationWindow: { min: 2, max: 100 },
  qualityThreshold: { min: 0.1, max: 1.0 },
  maxTurns: { min: 1, max: 500 },
  maxAutoRetries: { min: 0, max: 10 },
  maxConcurrentTasks: { min: 1, max: 10 },
  defaultTimeout: { min: 5, max: 180 },
  maxFixIterations: { min: 1, max: 10 },
  plannerMaxTurns: { min: 1, max: 100 },
  developerMaxTurns: { min: 1, max: 200 },
  testerMaxTurns: { min: 1, max: 100 },
  reviewerMaxTurns: { min: 1, max: 100 },
};

const ALLOWED_CONFIG_KEYS = new Set([
  "maxBudgetUsd",
  "maxEvaluationCycles",
  "stagnationWindow",
  "qualityThreshold",
  "maxTurns",
  "maxAutoRetries",
  "maxConcurrentTasks",
  "autonomyLevel",
  "defaultModel",
  "publicUrl",
  "defaultTimeout",
  "claudePath",
  "maxFixIterations",
  "plannerMaxTurns",
  "developerMaxTurns",
  "testerMaxTurns",
  "reviewerMaxTurns",
  "crewMode",
  "adaptiveEnabled",
  "activeProfile",
  "branchStrategy",
  "wecom.botId",
  "wecom.secret",
  "wecom.enabled",
]);

// ─── Notify / shutdown ─────────────────────────────────────────────────

type NotifyFn = (method: string, params: Record<string, unknown>) => void;
let notify: NotifyFn = () => {};

export function setNotifyFn(fn: NotifyFn): void {
  notify = fn;
  skillManager = new SkillManager(skillStore, notify);
}

export function shutdown(): void {
  for (const [runId, executor] of activeExecutors) {
    executor.stop();
    activeExecutors.delete(runId);
  }
}


export function recoverStaleRuns(): { runsReset: number; tasksReset: number; approvalsReset: number } {
  let runsReset = 0;
  let tasksReset = 0;
  let approvalsReset = 0;
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
    // Mark pending approvals as timed_out
    const pendingApprovals = store.getPendingApprovals(run.id);
    for (const approval of pendingApprovals) {
      store.updateApprovalRequest(run.id, approval.id, {
        status: "timed_out",
        resolvedAt: Date.now(),
      });
      approvalsReset++;
    }
  }
  return { runsReset, tasksReset, approvalsReset };
}

type MethodHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

// ─── Method metadata (optional, enriches master agent tool descriptions) ─

export interface MethodDescriptor {
  description: string;
  params: Array<{ name: string; type: string; required: boolean; description: string }>;
  category: string;
}

/** Optional metadata for RPC methods. MasterAgent reads methodHandlers keys + this metadata. */
export const methodMeta: Record<string, MethodDescriptor> = {};

// ─── Method handlers ───────────────────────────────────────────────────

export const methodHandlers: Record<string, MethodHandler> = {
  "run.list": async () => {
    return store.listRuns();
  },

  "run.create": async (params) => {
    const safeWorkingDir = validateWorkingDir(
      requireNonEmptyString(params, "workingDir"),
    );
    const goals = Array.isArray(params.goals) ? params.goals : [];
    const terminationConditions = Array.isArray(params.terminationConditions) ? params.terminationConditions : [];
    if (goals.length === 0) {
      throw new RpcValidationError("Parameter 'goals' must be a non-empty array");
    }
    if (terminationConditions.length === 0) {
      throw new RpcValidationError("Parameter 'terminationConditions' must be a non-empty array");
    }
    const run: ExecutionRun = {
      id: crypto.randomUUID(),
      workingDir: safeWorkingDir,
      goals,
      terminationConditions,
      status: "idle",
      totalCostUsd: 0,
      totalTasksCompleted: 0,
      autonomyLevel: params.autonomyLevel as ExecutionRun["autonomyLevel"],
      maxConcurrentTasks: typeof params.maxConcurrentTasks === "number" ? params.maxConcurrentTasks : undefined,
    };

    if (params.useDefaultLocation === true) {
      const ts = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
      const subfolder = `run-${ts}-${run.id.substring(0, 8)}`;
      const subfolderPath = join(safeWorkingDir, subfolder);
      mkdirSync(subfolderPath, { recursive: true });
      run.workingDir = subfolderPath;
    }
    store.saveRun(run);

    const tasks = params.tasks;
    if (tasks) {
      if (!Array.isArray(tasks)) {
        throw new RpcValidationError("Parameter 'tasks' must be an array when provided");
      }
      for (const t of tasks) {
        const task = queueManager.enqueue(run.id, t as import("@ai-workbench/shared").CreateTaskParams);
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

  "run.logs": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const limit = typeof params.limit === "number" ? params.limit : 1000;
    return store.getLogs(runId, undefined, limit);
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
      notify("run.status", { runId, status: "paused" });
      sessionManager.recordActivity({ userId: "system", runId, action: "run.stopped" });
    }
    return { status: "stopped" };
  },

  "run.update": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const run = store.getRun(runId);
    if (!run) throw new RpcValidationError("Run not found");
    if (Array.isArray(params.goals)) {
      if (params.goals.length === 0) throw new RpcValidationError("goals must be non-empty");
      run.goals = params.goals;
    }
    if (Array.isArray(params.terminationConditions)) {
      if (params.terminationConditions.length === 0) throw new RpcValidationError("terminationConditions must be non-empty");
      run.terminationConditions = params.terminationConditions;
    }
    store.saveRun(run);
    const { workingDir: _, ...safeRun } = run;
    notify("run.updated", { run: safeRun });
    return safeRun;
  },

  "run.delete": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const executor = activeExecutors.get(runId);
    if (executor) {
      executor.stop();
      activeExecutors.delete(runId);
    }
    shareStore.revokeByRunId(runId);
    subscriptionStore.unsubscribe(runId);
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
    const { type, priority, timeoutMinutes, promptJson, dependsOn, condition } = params as Record<string, unknown>;
    const task = queueManager.enqueue(runId, {
      content,
      type: (type ?? "user_defined") as "user_defined" | "smart_task",
      ...(priority !== undefined && { priority: Number(priority) }),
      ...(timeoutMinutes !== undefined && { timeoutMinutes: Number(timeoutMinutes) }),
      ...(promptJson !== undefined && { promptJson: String(promptJson) }),
      ...(Array.isArray(dependsOn) && { dependsOn: dependsOn.map(String) }),
      ...(typeof condition === "string" && { condition }),
      ...(typeof params.modelHint === "string" && { modelHint: params.modelHint }),
    });
    store.saveTask(runId, task);
    sessionManager.recordActivity({ userId: "system", runId, action: "task.created", details: { taskId: task.id, content: content.substring(0, 80) } });
    notify("queue.updated", { runId, queue: queueManager.list(runId) });

    // Auto-restart executor when adding tasks to a completed/failed run
    const currentRun = store.getRun(runId);
    if (currentRun && (currentRun.status === "completed" || currentRun.status === "failed") && !activeExecutors.has(runId)) {
      currentRun.status = "running";
      currentRun.completedAt = undefined;
      currentRun.finalReport = undefined;
      store.saveRun(currentRun);
      notify("run.status", { runId, status: "running" });
      const executor = new Executor(queueManager, notify, runId, store);
      activeExecutors.set(runId, executor);
      setImmediate(() => executor.start(currentRun).finally(() => { activeExecutors.delete(runId); }));
    }

    return task;
  },

  "task.start": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const run = store.getRun(runId);
    if (!run) throw new RpcValidationError(`Run ${runId} not found`);

    if (run.status === "completed" || run.status === "failed") {
      // Allow restarting completed/failed runs — reset completion state
      run.completedAt = undefined;
      run.finalReport = undefined;
    }

    const existingExecutor = activeExecutors.get(runId);
    if (existingExecutor && typeof existingExecutor.isRunning === "function" && existingExecutor.isRunning()) {
      throw new RpcValidationError(`Run ${runId} is already executing`);
    }
    if (existingExecutor) {
      activeExecutors.delete(runId);
    }

    const pendingTasks = store.listTasks(runId).filter((t) => t.status === "pending");
    for (const t of pendingTasks) {
      if (!queueManager.list(runId).some((q) => q.id === t.id)) {
        queueManager.restore(runId, t);
      }
    }

    run.status = "running";
    run.startedAt = run.startedAt || Date.now();
    store.saveRun(run);

    const executor = new Executor(queueManager, notify, runId, store);
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
      notify("run.status", { runId, status: "paused" });
    }
    return { status: "paused" };
  },

  "task.resume": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const run = store.getRun(runId);
    if (run && run.status === "paused") {
      const existingExecutor = activeExecutors.get(runId);
      if (existingExecutor && typeof existingExecutor.isRunning === "function" && existingExecutor.isRunning()) {
        throw new RpcValidationError(`Run ${runId} is already executing`);
      }
      if (existingExecutor) {
        activeExecutors.delete(runId);
      }

      const pendingTasks = store.listTasks(runId).filter((t) => t.status === "pending");
      for (const t of pendingTasks) {
        if (!queueManager.list(runId).some((q) => q.id === t.id)) {
          queueManager.restore(runId, t);
        }
      }
      run.status = "running";
      store.saveRun(run);
      const executor = new Executor(queueManager, notify, runId, store);
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
      const ex = new Executor(queueManager, notify, runId, store);
      activeExecutors.set(runId, ex);
      // Defer executor start so the RPC response (queue refresh) is sent first
      setImmediate(() => ex.start(run).finally(() => { activeExecutors.delete(runId); }));
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

  "task.update": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const taskId = requireString(params, "taskId");
    const task = store.getTask(runId, taskId);
    if (!task) throw new RpcValidationError(`Task not found: ${taskId}`);
    if (!["pending", "queued"].includes(task.status)) {
      throw new RpcValidationError(`Cannot edit task with status: ${task.status}`);
    }
    const updates: Partial<import("@ai-workbench/shared").TaskDefinition> = {};
    if (typeof params.content === "string" && params.content.trim()) updates.content = params.content.trim();
    if (typeof params.priority === "number" && Number.isFinite(params.priority) && params.priority >= 1 && params.priority <= 10) updates.priority = params.priority;
    if (typeof params.timeoutMinutes === "number" && Number.isFinite(params.timeoutMinutes) && params.timeoutMinutes >= 1 && params.timeoutMinutes <= 1440) updates.timeoutMinutes = params.timeoutMinutes;
    if (Object.keys(updates).length === 0) throw new RpcValidationError("No valid fields to update");
    store.updateTask(runId, taskId, updates);
    // Sync the in-memory queue entry with updated fields
    const queueList = queueManager.list(runId);
    const queueEntry = queueList.find((t: import("@ai-workbench/shared").TaskDefinition) => t.id === taskId);
    if (queueEntry) {
      Object.assign(queueEntry, updates);
    }
    if (updates.priority !== undefined) {
      notify("queue.updated", { runId, queue: queueManager.list(runId) });
    }
    return store.getTask(runId, taskId);
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

  "queue.remove": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const taskId = requireString(params, "taskId");
    const removed = queueManager.remove(runId, taskId);
    const deleted = store.deleteTask(runId, taskId);
    return { runId, taskId, removed: removed || deleted };
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

  // ─── Share methods ───────────────────────────────────────────────────────

  "share.create": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    if (!store.getRun(runId)) {
      throw new RpcValidationError(`Run not found: ${runId}`);
    }
    const label = typeof params.label === "string" ? params.label : "";
    const expiresAt = typeof params.expiresAt === "number" ? params.expiresAt : null;
    const token = shareStore.create(runId, label, expiresAt);
    const publicUrl = store.getConfig("publicUrl") || `http://localhost:${PORT}`;
    const directUrl = `${publicUrl}/#/share/${token.token}`;
    const apiUrl = `${publicUrl}/api/share/${token.token}`;
    return { token: token.token, url: directUrl, apiUrl, createdAt: token.createdAt };
  },

  "share.list": async (params) => {
    const runId = typeof params.runId === "string" ? params.runId : undefined;
    if (runId) validateRunId(runId);
    return shareStore.list(runId);
  },

  "share.revoke": async (params) => {
    const token = requireString(params, "token");
    const revoked = shareStore.revoke(token);
    if (!revoked) throw new RpcValidationError("Token not found");
    return { revoked: true };
  },

  "share.subscribe": async (params) => {
    const url = requireNonEmptyString(params, "url");
    // Support both API URL (http://host/api/share/<token>) and frontend URL (http://host/#/share/<token>)
    const apiMatch = url.match(/^(https?:\/\/[^/]+)\/api\/share\/([a-f0-9-]+)$/i);
    const frontendMatch = url.match(/^(https?:\/\/[^/#]+)\/#\/share\/([a-f0-9-]+)$/i);
    const match = apiMatch || frontendMatch;
    if (!match) {
      throw new RpcValidationError("Invalid share URL format. Expected: http://<host>:<port>/api/share/<token> or http://<host>:<port>/#/share/<token>");
    }
    const [, , remoteToken] = match;

    // Check if this is a local token (same engine)
    const localShare = shareStore.getByToken(remoteToken);
    if (!localShare) {
      throw new RpcValidationError("Remote share subscriptions are no longer supported. Only local share tokens can be subscribed.");
    }
    const localData = store.getRun(localShare.runId);
    if (!localData) throw new RpcValidationError(`Local share token found but run ${localShare.runId} does not exist`);

    return {
      runId: localShare.runId,
      run: localData,
    };
  },

  "share.unsubscribe": async (params) => {
    const runId = requireString(params, "runId");
    const removed = subscriptionStore.unsubscribe(runId);
    if (!removed) throw new RpcValidationError("Subscription not found");
    return { unsubscribed: true };
  },

  "share.subscriptions": async () => {
    return subscriptionStore.list();
  },

  // ─── Unified goal lifecycle methods ─────────────────────────────────────────

  "run.pauseGoal": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const run = store.getRun(runId);
    if (!run) throw new RpcValidationError(`Run not found: ${runId}`);
    if (run.goalStatus !== "pursuing") throw new RpcValidationError(`No pursuing goal for run: ${runId}`);
    run.goalTimeElapsedMs = Date.now() - (run.goalTimeStartedAt ?? Date.now());
    run.goalStatus = "paused";
    store.saveRun(run);
    const goalState = serializeGoalState(run);
    notify("goal.updated", { runId: run.id, goal: goalState });
    return { goalStatus: run.goalStatus };
  },

  "run.resumeGoal": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const run = store.getRun(runId);
    if (!run) throw new RpcValidationError(`Run not found: ${runId}`);
    if (run.goalStatus !== "paused") throw new RpcValidationError(`No paused goal for run: ${runId}`);
    run.goalTimeStartedAt = Date.now() - (run.goalTimeElapsedMs ?? 0);
    run.goalStatus = "pursuing";
    store.saveRun(run);
    const goalState = serializeGoalState(run);
    notify("goal.updated", { runId: run.id, goal: goalState });
    return { goalStatus: run.goalStatus };
  },

  "run.clearGoal": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const run = store.getRun(runId);
    if (!run) throw new RpcValidationError(`Run not found: ${runId}`);
    if (!run.goalStatus || run.goalStatus === "unmet") throw new RpcValidationError(`No active goal for run: ${runId}`);
    run.goalStatus = "unmet";
    run.goalEvidence = [];
    run.goalLastEvalReason = "";
    store.saveRun(run);
    const goalState = serializeGoalState(run);
    notify("goal.updated", { runId: run.id, goal: goalState });
    return { cleared: true };
  },

  // ─── Approval system ──────────────────────────────────────────────────────

  "approval.respond": async (params) => {
    const runId = requireString(params, "runId");
    const approvalId = requireString(params, "approvalId");
    const action = requireString(params, "action") as "approve" | "reject" | "modify";
    if (!["approve", "reject", "modify"].includes(action)) {
      throw new RpcValidationError("action must be approve, reject, or modify");
    }
    validateRunId(runId);
    const executor = activeExecutors.get(runId);
    if (!executor) {
      throw new RpcValidationError(`No active executor for run ${runId}`);
    }
    const instructions = typeof params.instructions === "string" ? params.instructions : undefined;
    const modifications = params.modifications as Record<string, unknown> | undefined;
    const resolved = executor.resolveApproval(approvalId, { action, instructions, modifications });
    if (!resolved) {
      throw new RpcValidationError(`Approval ${approvalId} not found or already resolved`);
    }
    sessionManager.recordActivity({ userId: "system", runId, action: "approval.responded", details: { approvalId, action } });
    return { approvalId, resolved: true };
  },

  // ─── Session & Identity ─────────────────────────────────────────────────

  "session.identify": async (params) => {
    const session = sessionManager.identify({
      userId: params.userId as string | undefined,
      displayName: params.displayName as string | undefined,
      role: params.role as "owner" | "collaborator" | "viewer" | undefined,
      sessionId: params.sessionId as string | undefined,
    });
    return session;
  },

  "session.list": async () => {
    return { sessions: sessionManager.listActive() };
  },

  // ─── Activity Timeline ──────────────────────────────────────────────────

  "activity.list": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const limit = params.limit as number | undefined;
    return { activities: sessionManager.getActivities(runId, limit) };
  },

  // ─── Comments ───────────────────────────────────────────────────────────

  "comment.create": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const taskId = requireString(params, "taskId");
    const content = requireNonEmptyString(params, "content");
    const userId = (params.userId as string) || "anonymous";
    const displayName = (params.displayName as string) || userId;

    const comment = sessionManager.addComment({ taskId, runId, userId, displayName, content });

    const event = sessionManager.recordActivity({
      userId, runId, action: "comment.created",
      details: { taskId, commentId: comment.id },
    });

    return { comment, activity: event };
  },

  "comment.list": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const taskId = params.taskId as string | undefined;
    return { comments: sessionManager.getComments(runId, taskId) };
  },

  // ─── Skills ────────────────────────────────────────────────────────────

  "skill.list": async (params) => {
    const type = params.type as "builtin" | "custom" | undefined;
    return skillStore.list(type ? { type } : undefined);
  },

  "skill.delete": async (params) => {
    const name = requireString(params, "name");
    const skill = skillStore.findByName(name);
    if (!skill) throw new RpcValidationError(`Skill not found: ${name}`);
    if (skill.type === "builtin") throw new RpcValidationError("Cannot delete builtin skills");
    const removed = skillStore.remove(name);
    if (removed) {
      notify("skill.removed", { name });
    }
    return { ok: removed };
  },

  // ─── Crew / Agent roles ────────────────────────────────────────────────

  "crew.list": async () => {
    return Object.values(OMX_ROLES).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description.slice(0, 120),
      tools: r.tools,
      maxTurns: r.maxTurns,
    }));
  },

  "crew.configure": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const mode = (params.mode as CrewMode) || undefined;
    const maxFixIterations = typeof params.maxFixIterations === "number" ? params.maxFixIterations : undefined;
    if (mode && !["sequential", "fixloop", "parallel", "adaptive"].includes(mode)) {
      throw new RpcValidationError("mode must be sequential, fixloop, parallel, or adaptive");
    }
    if (mode) store.setConfig(`${runId}:crewMode`, mode);
    if (maxFixIterations) store.setConfig(`${runId}:maxFixIterations`, maxFixIterations);
    return { runId, mode: mode || store.getConfig(`${runId}:crewMode`) || DEFAULT_CREW_CONFIG.mode, saved: true };
  },


  // ─── Plugin / MCP Server ───────────────────────────────────────────────

  "plugin.list": async () => {
    return pluginRegistry.list();
  },

  "plugin.install": async (params) => {
    const name = requireNonEmptyString(params, "name");
    const command = requireNonEmptyString(params, "command");
    const args = Array.isArray(params.args) ? params.args.map(String) : [];
    const env = params.env as Record<string, string> | undefined;
    const config: McpServerConfig = { name, command, args, env };
    const entry = pluginRegistry.register(config);
    notify("plugin.updated", { plugin: entry });
    return entry;
  },

  "plugin.remove": async (params) => {
    const id = requireString(params, "id");
    const entry = pluginRegistry.get(id);
    if (!entry) throw new RpcValidationError(`Plugin not found: ${id}`);
    const removed = pluginRegistry.unregister(id);
    notify("plugin.updated", { removed: id });
    return { ok: removed };
  },

  "plugin.toggle": async (params) => {
    const id = requireString(params, "id");
    const entry = pluginRegistry.get(id);
    if (!entry) throw new RpcValidationError(`Plugin not found: ${id}`);
    const enabled = !entry.enabled;
    pluginRegistry.setEnabled(id, enabled);
    pluginRegistry.setStatus(id, enabled ? "running" : "stopped");
    const updated = pluginRegistry.get(id);
    notify("plugin.updated", { plugin: updated });
    return updated;
  },

  // ─── Adaptive config ────────────────────────────────────────────────────

  "config.adaptive": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const enabled = params.enabled as boolean | undefined;
    if (enabled !== undefined) {
      store.setConfig("adaptiveEnabled", enabled);
    }
    return { adaptiveEnabled: store.getConfig("adaptiveEnabled") ?? false };
  },

  // ─── Orchestrator Profiles ─────────────────────────────────────────────

  "profile.list": async () => {
    const builtIn = getBuiltInProfiles();
    const custom = store.listProfiles();
    return [...builtIn, ...custom];
  },

  "profile.get": async (params) => {
    const id = requireString(params, "id");
    const builtIn = getBuiltInProfiles();
    const found = builtIn.find((p) => p.id === id) ?? store.listProfiles().find((p) => p.id === id);
    if (!found) throw new Error(`Profile not found: ${id}`);
    return found;
  },

  "profile.set": async (params) => {
    const profile = params.profile as import("@ai-workbench/shared").OrchestratorProfile | undefined;
    if (!profile || !profile.id || !profile.name || !profile.config) {
      throw new Error("Missing required parameter: profile (with id, name, config)");
    }
    const builtIn = getBuiltInProfiles();
    if (builtIn.some((p) => p.id === profile.id)) {
      throw new Error("Cannot modify built-in profiles");
    }
    profile.updatedAt = Date.now();
    store.saveProfile({ ...profile, isBuiltIn: false });
    return { saved: true };
  },

  "profile.delete": async (params) => {
    const id = requireString(params, "id");
    const builtIn = getBuiltInProfiles();
    if (builtIn.some((p) => p.id === id)) {
      throw new Error("Cannot delete built-in profiles");
    }
    const deleted = store.deleteProfile(id);
    return { deleted };
  },


  // ─── Real-time Intervention ──────────────────────────────────────────────

  "task.intervene": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const taskId = requireString(params, "taskId");
    const action = requireString(params, "action");
    if (!["pause", "cancel", "skip"].includes(action)) {
      throw new RpcValidationError("action must be one of: pause, cancel, skip");
    }
    const task = store.getTask(runId, taskId);
    if (!task) throw new RpcValidationError("Task not found");
    const executor = activeExecutors.get(runId);
    if (!executor) throw new RpcValidationError("No active executor for this run");

    if (action === "cancel") {
      executor.cancelTask(taskId, runId);
      return { intervened: true, action: "cancelled" };
    }
    if (action === "pause") {
      store.updateTask(runId, taskId, { status: "paused" });
      notify("task.status", { taskId, runId, status: "paused" });
      return { intervened: true, action: "paused" };
    }
    store.updateTask(runId, taskId, { status: "skipped", completedAt: Date.now() });
    notify("task.status", { taskId, runId, status: "skipped" });
    return { intervened: true, action: "skipped" };
  },

  "task.inject": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const taskId = requireString(params, "taskId");
    const instruction = requireNonEmptyString(params, "instruction");
    const task = store.getTask(runId, taskId);
    if (!task) throw new RpcValidationError("Task not found");

    // Inject as a high-priority user task
    const injectedTask = queueManager.enqueue(runId, {
      content: `[Human injection for ${taskId.slice(0, 8)}] ${instruction}`,
      type: "user_defined",
      priority: 1,
    });
    store.saveTask(runId, injectedTask);
    sessionManager.recordActivity({ userId: "system", runId, action: "task.injected", details: { targetTaskId: taskId, instruction: instruction.substring(0, 100) } });
    notify("queue.updated", { runId, queue: queueManager.list(runId) });
    return { injected: true, newTaskId: injectedTask.id };
  },

};

// ─── Method metadata for master agent (optional enrichment) ─────────────
// Methods without metadata are still available to the agent with generic descriptions.

Object.assign(methodMeta, {
  "run.list": {
    description: "列出所有任务运行（包含状态、进度、成本等信息）",
    params: [],
    category: "run",
  },
  "run.create": {
    description: "创建新的任务运行。需要工作目录、目标和终止条件。",
    params: [
      { name: "workingDir", type: "string", required: true, description: "工作目录路径" },
      { name: "goals", type: "string[]", required: true, description: "任务目标列表" },
      { name: "terminationConditions", type: "string[]", required: true, description: "终止条件列表" },
      { name: "tasks", type: "array", required: false, description: "预定义子任务" },
    ],
    category: "run",
  },
  "run.stop": {
    description: "停止正在运行的任务执行",
    params: [{ name: "runId", type: "string", required: true, description: "运行 ID" }],
    category: "run",
  },
  "run.delete": {
    description: "删除一个任务运行",
    params: [{ name: "runId", type: "string", required: true, description: "运行 ID" }],
    category: "run",
  },
  "run.update": {
    description: "更新任务运行的目标和终止条件",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "goals", type: "string[]", required: false, description: "新目标" },
      { name: "terminationConditions", type: "string[]", required: false, description: "新终止条件" },
    ],
    category: "run",
  },
  "run.report": {
    description: "获取任务运行的详细报告",
    params: [{ name: "runId", type: "string", required: true, description: "运行 ID" }],
    category: "run",
  },
  "run.tasks": {
    description: "列出某个运行中的所有子任务",
    params: [{ name: "runId", type: "string", required: true, description: "运行 ID" }],
    category: "run",
  },
  "run.commits": {
    description: "获取某个运行的 git 提交记录",
    params: [{ name: "runId", type: "string", required: true, description: "运行 ID" }],
    category: "run",
  },
  "run.lessons": {
    description: "获取某个运行的教训记录",
    params: [{ name: "runId", type: "string", required: true, description: "运行 ID" }],
    category: "run",
  },
  "task.create": {
    description: "向运行中添加新的子任务",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "content", type: "string", required: true, description: "任务内容描述" },
      { name: "type", type: "string", required: false, description: "任务类型: user_defined 或 ai_generated" },
      { name: "priority", type: "number", required: false, description: "优先级，数字越小越优先" },
    ],
    category: "task",
  },
  "task.start": {
    description: "开始执行任务（启动自进化循环）",
    params: [{ name: "runId", type: "string", required: true, description: "运行 ID" }],
    category: "task",
  },
  "task.pause": {
    description: "暂停正在运行的任务",
    params: [{ name: "runId", type: "string", required: true, description: "运行 ID" }],
    category: "task",
  },
  "task.resume": {
    description: "恢复已暂停的任务",
    params: [{ name: "runId", type: "string", required: true, description: "运行 ID" }],
    category: "task",
  },
  "task.cancel": {
    description: "取消某个子任务",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "taskId", type: "string", required: true, description: "子任务 ID" },
    ],
    category: "task",
  },
  "task.retry": {
    description: "重试失败的子任务",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "taskId", type: "string", required: true, description: "子任务 ID" },
    ],
    category: "task",
  },
  "task.update": {
    description: "更新子任务内容或优先级",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "taskId", type: "string", required: true, description: "子任务 ID" },
      { name: "content", type: "string", required: false, description: "新内容" },
      { name: "priority", type: "number", required: false, description: "新优先级" },
    ],
    category: "task",
  },
  "task.intervene": {
    description: "干预子任务：暂停、取消或跳过",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "taskId", type: "string", required: true, description: "子任务 ID" },
      { name: "action", type: "string", required: true, description: "操作: pause/cancel/skip" },
    ],
    category: "task",
  },
  "task.inject": {
    description: "向运行中的子任务注入指令",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "taskId", type: "string", required: true, description: "子任务 ID" },
      { name: "instruction", type: "string", required: true, description: "注入的指令内容" },
    ],
    category: "task",
  },
  "queue.list": {
    description: "查看任务执行队列",
    params: [{ name: "runId", type: "string", required: true, description: "运行 ID" }],
    category: "queue",
  },
  "queue.reorder": {
    description: "重新排列任务队列顺序",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "taskIds", type: "string[]", required: true, description: "新的任务 ID 顺序" },
    ],
    category: "queue",
  },
  "queue.remove": {
    description: "从队列中移除任务",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "taskId", type: "string", required: true, description: "要移除的任务 ID" },
    ],
    category: "queue",
  },
  "config.get": {
    description: "获取引擎配置值",
    params: [{ name: "key", type: "string", required: true, description: "配置键名" }],
    category: "config",
  },
  "config.set": {
    description: "设置引擎配置值",
    params: [
      { name: "key", type: "string", required: true, description: "配置键名" },
      { name: "value", type: "any", required: true, description: "配置值" },
    ],
    category: "config",
  },
  "share.create": {
    description: "创建任务分享链接",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "label", type: "string", required: false, description: "分享标签" },
    ],
    category: "share",
  },
  "share.list": {
    description: "列出所有分享链接",
    params: [{ name: "runId", type: "string", required: false, description: "运行 ID（可选，不传则列出全部）" }],
    category: "share",
  },
  "share.revoke": {
    description: "撤销分享链接",
    params: [{ name: "token", type: "string", required: true, description: "分享 token" }],
    category: "share",
  },
  "activity.list": {
    description: "查看活动时间线",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "limit", type: "number", required: false, description: "返回条数限制" },
    ],
    category: "activity",
  },
  "comment.list": {
    description: "查看任务评论",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "taskId", type: "string", required: false, description: "子任务 ID（可选）" },
    ],
    category: "comment",
  },
  "comment.create": {
    description: "添加任务评论",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "taskId", type: "string", required: true, description: "子任务 ID" },
      { name: "content", type: "string", required: true, description: "评论内容" },
    ],
    category: "comment",
  },
  "crew.list": {
    description: "查看可用的 Agent 角色列表",
    params: [],
    category: "crew",
  },
  "crew.configure": {
    description: "配置任务的 Agent 协作模式",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "mode", type: "string", required: false, description: "协作模式" },
    ],
    category: "crew",
  },
  "skill.list": {
    description: "查看已安装的技能列表",
    params: [{ name: "type", type: "string", required: false, description: "技能类型过滤" }],
    category: "skill",
  },
  "plugin.list": {
    description: "查看已安装的插件列表",
    params: [],
    category: "plugin",
  },
  "approval.respond": {
    description: "响应审批请求（批准/拒绝/修改）",
    params: [
      { name: "runId", type: "string", required: true, description: "运行 ID" },
      { name: "approvalId", type: "string", required: true, description: "审批 ID" },
      { name: "action", type: "string", required: true, description: "操作: approve/reject/modify" },
    ],
    category: "approval",
  },
  "run.pauseGoal": {
    description: "暂停目标评估",
    params: [{ name: "runId", type: "string", required: true, description: "运行 ID" }],
    category: "run",
  },
  "run.resumeGoal": {
    description: "恢复目标评估",
    params: [{ name: "runId", type: "string", required: true, description: "运行 ID" }],
    category: "run",
  },
  "profile.list": {
    description: "查看编排器配置列表",
    params: [],
    category: "profile",
  },
  "wecom.status": {
    description: "查看企业微信机器人连接状态",
    params: [],
    category: "wecom",
  },
  "wecom.test": {
    description: "发送测试消息到企业微信",
    params: [
      { name: "target", type: "string", required: true, description: "用户ID或群聊ID" },
      { name: "content", type: "string", required: true, description: "消息内容（支持Markdown）" },
    ],
    category: "wecom",
  },
});

// ─── Chat (Master Agent) RPC methods ────────────────────────────────────

import { MasterAgent } from "../engine/master-agent/master-agent.js";

const masterAgent = new MasterAgent();

methodHandlers["chat.send"] = async (params) => {
  const message = requireNonEmptyString(params, "message");
  const sessionId = typeof params.sessionId === "string" && params.sessionId
    ? params.sessionId
    : crypto.randomUUID();

  // Fire-and-forget: agent streams results via notifications
  masterAgent.handleMessage(sessionId, message, notify).catch((err) => {
    notify("chat.error", { sessionId, error: err instanceof Error ? err.message : String(err) });
  });

  return { sessionId, status: "processing" };
};

methodHandlers["chat.history"] = async (params) => {
  const sessionId = requireString(params, "sessionId");
  const messages = masterAgent.getHistory(sessionId);
  return { sessionId, messages };
};

methodHandlers["chat.clear"] = async (params) => {
  const sessionId = requireString(params, "sessionId");
  masterAgent.clearSession(sessionId);
  return { cleared: true };
};

// ─── WeChat Work (企业微信) Bot ──────────────────────────────────────────

import { WeComBot } from "../engine/master-agent/wecom-bot.js";

let wecomBot: WeComBot | null = null;

export function initWeComBot(): void {
  wecomBot = new WeComBot(masterAgent, store);
  wecomBot.start().catch((err) => {
    log.error(`[wecom] Failed to start: ${err instanceof Error ? err.message : err}`);
  });
}

export function getWeComBot(): WeComBot | null {
  return wecomBot;
}

methodHandlers["wecom.status"] = async () => {
  if (!wecomBot) return { enabled: false, connected: false };
  return wecomBot.getStatus();
};

methodHandlers["wecom.test"] = async (params) => {
  if (!wecomBot || !wecomBot.isRunning()) {
    throw new RpcValidationError("WeChat Work bot is not running. Enable and configure it in settings first.");
  }
  const target = requireNonEmptyString(params, "target");
  const content = requireNonEmptyString(params, "content");
  await wecomBot.sendProactiveMessage(target, content);
  return { sent: true };
};
