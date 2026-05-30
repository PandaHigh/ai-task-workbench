import type { CreateRunParams, ExecutionRun } from "@ai-workbench/shared";
import { Store } from "../db/store.js";
import { ShareStore } from "../db/share-store.js";
import { SubscriptionStore } from "../db/subscription-store.js";
import { SkillStore } from "../db/skill-store.js";
import { SkillManager } from "../skills/skill-manager.js";
import { QueueManager } from "../engine/queue-manager.js";
import { Executor } from "../engine/executor.js";
import { SessionManager } from "../engine/session-manager.js";
import * as wizardHandler from "../wizard/wizard-handler.js";
import * as remoteProxy from "../remote/remote-proxy.js";
import { resolve, normalize } from "path";
import { homedir, tmpdir } from "os";
import { errorToMessage } from "../lib/error-utils.js";
import { serializeGoalState } from "../lib/goal-utils.js";

const PORT = 9731;

const store = new Store();
const shareStore = new ShareStore();
const subscriptionStore = new SubscriptionStore();
const skillStore = new SkillStore();
const queueManager = new QueueManager();
let skillManager: SkillManager;

export { store, shareStore, subscriptionStore, queueManager, skillStore, skillManager };
const sessionManager = new SessionManager(store);
const activeExecutors = new Map<string, Executor>();

export { sessionManager };

// ─── Remote run detection ────────────────────────────────────────────────

function getRemoteInfo(runId: string): { url: string; token: string } | null {
  const sub = subscriptionStore.getByRunId(runId);
  return sub ? { url: sub.remoteUrl, token: sub.remoteToken } : null;
}

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
  "defaultModel",
  "publicUrl",
  "defaultTimeout",
  "claudePath",
  "maxFixIterations",
  "plannerMaxTurns",
  "developerMaxTurns",
  "testerMaxTurns",
  "reviewerMaxTurns",
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

// ─── Method handlers ───────────────────────────────────────────────────

export const methodHandlers: Record<string, MethodHandler> = {
  "run.list": async () => {
    const localRuns = store.listRuns();
    const subs = subscriptionStore.list();
    const remoteRuns: ExecutionRun[] = [];
    for (const sub of subs) {
      try {
        const remoteRun = await remoteProxy.fetchRemoteRun(sub.remoteUrl, sub.remoteToken);
        remoteRuns.push({
          ...remoteRun,
          id: sub.runId,
          source: "remote",
          remoteUrl: sub.remoteUrl,
          remoteToken: sub.remoteToken,
          lastSyncedAt: sub.lastSyncedAt,
        });
      } catch {
        // Remote unreachable — include cached metadata from subscription
        remoteRuns.push({
          id: sub.runId,
          workingDir: "",
          goals: [sub.label || "Remote dashboard (offline)"],
          terminationConditions: [],
          status: "idle",
          totalCostUsd: 0,
          totalTasksCompleted: 0,
          source: "remote",
          remoteUrl: sub.remoteUrl,
          remoteToken: sub.remoteToken,
          lastSyncedAt: sub.lastSyncedAt,
        });
      }
    }
    return [...localRuns, ...remoteRuns];
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
    const remote = getRemoteInfo(runId);
    if (remote) return remoteProxy.fetchRemoteTasks(remote.url, remote.token);
    return store.listTasks(runId);
  },

  "run.commits": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const remote = getRemoteInfo(runId);
    if (remote) return remoteProxy.fetchRemoteCommits(remote.url, remote.token);
    return store.getCommits(runId);
  },

  "run.lessons": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const remote = getRemoteInfo(runId);
    if (remote) return remoteProxy.fetchRemoteLessons(remote.url, remote.token);
    return store.getLessons(runId);
  },

  "run.logs": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const remote = getRemoteInfo(runId);
    if (remote) return remoteProxy.fetchRemoteLogs(remote.url, remote.token);
    const limit = typeof params.limit === "number" ? params.limit : 200;
    return store.getLogs(runId, undefined, limit);
  },

  "run.stop": async (params) => {
    const runId = requireString(params, "runId");
    validateRunId(runId);
    const remote = getRemoteInfo(runId);
    if (remote) {
      await remoteProxy.remoteRunStop(remote.url, remote.token);
      return { status: "stopped" };
    }
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
    const remote = getRemoteInfo(runId);
    if (remote) {
      return remoteProxy.remoteTaskCreate(remote.url, remote.token, {
        content,
        type: (params.type ?? "user_defined") as string,
        ...(params.priority !== undefined && { priority: Number(params.priority) }),
        ...(params.timeoutMinutes !== undefined && { timeoutMinutes: Number(params.timeoutMinutes) }),
      });
    }
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
    sessionManager.recordActivity({ userId: "system", runId, action: "task.created", details: { taskId: task.id, content: content.substring(0, 80) } });
    notify("queue.updated", { runId, queue: queueManager.list(runId) });

    // Auto-restart executor when adding tasks to a completed/failed run
    const currentRun = store.getRun(runId);
    if (currentRun && (currentRun.status === "completed" || currentRun.status === "failed") && !activeExecutors.has(runId)) {
      currentRun.status = "running";
      currentRun.completedAt = undefined;
      currentRun.finalReport = undefined;
      store.saveRun(currentRun);
      const executor = new Executor(queueManager, notify, runId);
      activeExecutors.set(runId, executor);
      if (activeExecutors.has(runId)) return task;
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
    run.startedAt = run.startedAt || Date.now();
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
      notify("run.status", { runId, status: "paused" });
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
    const remote = getRemoteInfo(runId);
    if (remote) {
      await remoteProxy.remoteTaskRetry(remote.url, remote.token, taskId);
      return { taskId, status: "pending" };
    }
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
      // Defer executor start so the RPC response (queue refresh) is sent first
      setImmediate(() => ex.start(run).finally(() => { activeExecutors.delete(runId); }));
    }
    return { taskId, status: "pending", newQueueTaskId: restored.id };
  },

  "task.setTimeout": async (params) => {
    const runId = requireString(params, "runId");
    const taskId = requireString(params, "taskId");
    validateRunId(runId);
    const remote = getRemoteInfo(runId);
    if (remote) {
      const { minutes } = params as { minutes: number };
      await remoteProxy.remoteTaskSetTimeout(remote.url, remote.token, taskId, minutes);
      return { taskId, timeoutMinutes: minutes };
    }
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
    const remote = getRemoteInfo(runId);
    if (!store.getRun(runId) && !remote) {
      throw new RpcValidationError(`Run not found: ${runId}`);
    }
    if (remote) {
      return { token: remote.token, url: `${remote.url}/#/share/${remote.token}`, apiUrl: `${remote.url}/api/share/${remote.token}`, createdAt: Date.now() };
    }
    const label = typeof params.label === "string" ? params.label : "";
    const token = shareStore.create(runId, label);
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
    const [, remoteUrl, remoteToken] = match;

    // Fetch remote run metadata
    let remoteRun: ExecutionRun;
    try {
      remoteRun = await remoteProxy.fetchRemoteRun(remoteUrl, remoteToken);
    } catch (err) {
      throw new RpcValidationError(`Failed to fetch remote run: ${errorToMessage(err)}`);
    }

    const localRunId = `remote-${remoteRun.id.slice(0, 8)}-${Date.now().toString(36)}`;
    const sub = subscriptionStore.subscribe({
      runId: localRunId,
      remoteUrl,
      remoteToken,
      remoteRunId: remoteRun.id,
      label: remoteRun.goals[0] || "Remote dashboard",
    });

    // Establish real-time WebSocket connection to remote engine
    try {
      const { connectRemoteWS } = await import("../remote/remote-proxy.js");
      connectRemoteWS(localRunId, remoteUrl, remoteToken, notify);
    } catch (wsErr) {
      console.warn("[share.subscribe] WebSocket connection to remote failed, will retry:", errorToMessage(wsErr));
    }

    return {
      runId: sub.runId,
      remoteRun: {
        ...remoteRun,
        id: sub.runId,
        source: "remote",
        remoteUrl,
        remoteToken,
        lastSyncedAt: sub.lastSyncedAt,
      },
    };
  },

  "share.unsubscribe": async (params) => {
    const runId = requireString(params, "runId");
    const { disconnectRemoteWS } = await import("../remote/remote-proxy.js");
    disconnectRemoteWS(runId);
    const removed = subscriptionStore.unsubscribe(runId);
    if (!removed) throw new RpcValidationError(`Subscription not found for runId: ${runId}`);
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
};
