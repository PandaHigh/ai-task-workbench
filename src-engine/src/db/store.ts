import fs from "fs";
import path from "path";
import type {
  ExecutionRun,
  TaskDefinition,
  TaskLog,
  GitCommit,
  LessonLearned,
  ScoreDetails,
  ApprovalRequest,
  OrchestratorProfile,
} from "@ai-workbench/shared";
import { getDataDir, ensureDir, readJsonFile, writeJsonFile, cleanupTmpFiles } from "./store-utils.js";

const MAX_LOG_ENTRIES = 1000;
const MAX_HISTORY_ENTRIES = 500;

export class Store {
  private dataDir: string;
  private runsDir: string;
  private pendingWrites = new Map<string, { data: unknown; timer: ReturnType<typeof setTimeout> }>();
  private runIndex: Map<string, ExecutionRun> | null = null;
  private noDebounce: boolean;

  constructor(customDataDir?: string, options?: { noDebounce?: boolean }) {
    this.dataDir = customDataDir || getDataDir();
    this.runsDir = path.join(this.dataDir, "runs");
    this.noDebounce = options?.noDebounce ?? process.env.NODE_ENV === "test";
    ensureDir(this.runsDir);
    cleanupTmpFiles(this.runsDir);
  }

  /** Debounce writes to the same file, merging rapid successive writes. */
  private debouncedWrite(filePath: string, data: unknown, delayMs = 5): void {
    if (this.noDebounce) {
      writeJsonFile(filePath, data);
      return;
    }
    const existing = this.pendingWrites.get(filePath);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pendingWrites.delete(filePath);
      writeJsonFile(filePath, data);
    }, delayMs);
    this.pendingWrites.set(filePath, { data, timer });
  }

  /** Flush all pending writes immediately. Call during graceful shutdown. */
  flush(): void {
    for (const [filePath, { data, timer }] of this.pendingWrites) {
      clearTimeout(timer);
      writeJsonFile(filePath, data);
    }
    this.pendingWrites.clear();
  }

  /** Build (or return cached) run index for O(1) lookups by id. */
  private getRunIndex(): Map<string, ExecutionRun> {
    if (!this.runIndex) {
      const runs = this.listRuns();
      this.runIndex = new Map(runs.map((r) => [r.id, r]));
    }
    return this.runIndex;
  }

  /** Invalidate the run index cache — call after mutations. */
  private invalidateRunIndex(): void {
    this.runIndex = null;
  }

  // ---- Execution Runs ----

  listRuns(): ExecutionRun[] {
    const indexFile = path.join(this.runsDir, "index.json");
    return readJsonFile<ExecutionRun[]>(indexFile, []);
  }

  getRun(runId: string): ExecutionRun | undefined {
    return this.getRunIndex().get(runId);
  }

  saveRun(run: ExecutionRun): void {
    const runs = this.listRuns();
    const idx = runs.findIndex((r) => r.id === run.id);
    if (idx >= 0) {
      runs[idx] = run;
    } else {
      runs.push(run);
    }
    writeJsonFile(path.join(this.runsDir, "index.json"), runs);
    this.invalidateRunIndex();
  }

  deleteRun(runId: string): void {
    // Delete directory first for atomicity — if index write fails later,
    // a stale entry pointing to a missing directory is less dangerous than
    // an orphan directory consuming disk space silently.
    const runDir = path.join(this.runsDir, runId);
    if (fs.existsSync(runDir)) {
      fs.rmSync(runDir, { recursive: true });
    }
    // Then update index
    const runs = this.listRuns().filter((r) => r.id !== runId);
    writeJsonFile(path.join(this.runsDir, "index.json"), runs);
    this.invalidateRunIndex();
  }

  listRunsPaginated(options: { page?: number; pageSize?: number; status?: string }): {
    runs: ExecutionRun[];
    total: number;
    page: number;
    pageSize: number;
  } {
    const all = this.listRuns();
    const filtered = options.status ? all.filter((r) => r.status === options.status) : all;
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    return {
      runs: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
    };
  }

  // ---- Tasks ----

  private runDir(runId: string): string {
    const dir = path.join(this.runsDir, runId);
    ensureDir(dir);
    return dir;
  }

  listTasks(runId: string): TaskDefinition[] {
    const file = path.join(this.runDir(runId), "tasks.json");
    return readJsonFile<TaskDefinition[]>(file, []);
  }

  listTasksPaginated(
    runId: string,
    options: { page?: number; pageSize?: number; status?: string },
  ): { tasks: TaskDefinition[]; total: number; page: number; pageSize: number } {
    const all = this.listTasks(runId);
    const filtered = options.status ? all.filter((t) => t.status === options.status) : all;
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 50;
    const start = (page - 1) * pageSize;
    return {
      tasks: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
    };
  }

  getTask(runId: string, taskId: string): TaskDefinition | undefined {
    return this.listTasks(runId).find((t) => t.id === taskId);
  }

  deleteTask(runId: string, taskId: string): boolean {
    const tasks = this.listTasks(runId);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return false;
    tasks.splice(idx, 1);
    writeJsonFile(path.join(this.runDir(runId), "tasks.json"), tasks);
    return true;
  }

  saveTask(runId: string, task: TaskDefinition): void {
    const tasks = this.listTasks(runId);
    const idx = tasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) {
      tasks[idx] = task;
    } else {
      tasks.push(task);
    }
    writeJsonFile(path.join(this.runDir(runId), "tasks.json"), tasks);
  }

  updateTask(runId: string, taskId: string, updates: Partial<TaskDefinition>): void {
    const tasks = this.listTasks(runId);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx >= 0) {
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, v === null ? undefined : v]),
      );
      const merged = { ...tasks[idx] };
      for (const [k, v] of Object.entries(cleanUpdates)) {
        if (v === undefined) {
          delete (merged as Record<string, unknown>)[k];
        } else {
          (merged as Record<string, unknown>)[k] = v;
        }
      }
      tasks[idx] = merged as TaskDefinition;
      writeJsonFile(path.join(this.runDir(runId), "tasks.json"), tasks);
    }
  }

  // ---- Logs ----

  appendLog(runId: string, log: Omit<TaskLog, "id">): void {
    const file = path.join(this.runDir(runId), "logs.json");
    const logs = readJsonFile<TaskLog[]>(file, []);
    logs.push({ ...log, id: logs.length + 1 });
    // Keep last MAX_LOG_ENTRIES logs in file
    const trimmed = logs.length > MAX_LOG_ENTRIES ? logs.slice(-MAX_LOG_ENTRIES) : logs;
    this.debouncedWrite(file, trimmed);
  }

  getLogs(runId: string, taskId?: string, limit?: number): TaskLog[] {
    const file = path.join(this.runDir(runId), "logs.json");
    let logs = readJsonFile<TaskLog[]>(file, []);
    if (taskId) {
      logs = logs.filter((l) => l.taskId === taskId);
    }
    if (limit) {
      logs = logs.slice(-limit);
    }
    return logs;
  }

  // ---- Git Commits ----

  appendCommit(runId: string, commit: Omit<GitCommit, "id">): void {
    const file = path.join(this.runDir(runId), "commits.json");
    const commits = readJsonFile<GitCommit[]>(file, []);
    commits.push({ ...commit, id: commits.length + 1 });
    const trimmed = commits.length > MAX_HISTORY_ENTRIES ? commits.slice(-MAX_HISTORY_ENTRIES) : commits;
    this.debouncedWrite(file, trimmed);
  }

  getCommits(runId: string, limit?: number): GitCommit[] {
    const file = path.join(this.runDir(runId), "commits.json");
    const commits = readJsonFile<GitCommit[]>(file, []);
    return limit ? commits.slice(-limit) : commits;
  }

  // ---- Lessons Learned ----

  appendLesson(runId: string, lesson: Omit<LessonLearned, "id">): void {
    const file = path.join(this.runDir(runId), "lessons.json");
    const lessons = readJsonFile<LessonLearned[]>(file, []);
    lessons.push({ ...lesson, id: lessons.length + 1 });
    const trimmed = lessons.length > MAX_HISTORY_ENTRIES ? lessons.slice(-MAX_HISTORY_ENTRIES) : lessons;
    this.debouncedWrite(file, trimmed);
  }

  getLessons(runId: string, category?: string): LessonLearned[] {
    const file = path.join(this.runDir(runId), "lessons.json");
    let lessons = readJsonFile<LessonLearned[]>(file, []);
    if (category) {
      lessons = lessons.filter((l) => l.category === category);
    }
    return lessons;
  }

  // ---- Scoring History ----

  appendScore(runId: string, taskId: string, score: ScoreDetails): void {
    const file = path.join(this.runDir(runId), "scores.json");
    const scores = readJsonFile<Array<{ taskId: string; score: ScoreDetails; timestamp: number }>>(file, []);
    scores.push({ taskId, score, timestamp: Date.now() });
    const trimmed = scores.length > MAX_HISTORY_ENTRIES ? scores.slice(-MAX_HISTORY_ENTRIES) : scores;
    this.debouncedWrite(file, trimmed);
  }

  getScores(runId: string): Array<{ taskId: string; score: ScoreDetails; timestamp: number }> {
    const file = path.join(this.runDir(runId), "scores.json");
    return readJsonFile(file, []);
  }

  // ---- Config ----

  getConfig(key: string): unknown {
    const file = path.join(this.dataDir, "config.json");
    const config = readJsonFile<Record<string, unknown>>(file, {});
    return config[key];
  }

  setConfig(key: string, value: unknown): void {
    const file = path.join(this.dataDir, "config.json");
    const config = readJsonFile<Record<string, unknown>>(file, {});
    config[key] = value;
    writeJsonFile(file, config);
  }

  // ---- Comments ----

  appendComment(runId: string, comment: import("@ai-workbench/shared").TaskComment): void {
    const file = path.join(this.runDir(runId), "comments.json");
    const comments = readJsonFile<import("@ai-workbench/shared").TaskComment[]>(file, []);
    comments.push(comment);
    const trimmed = comments.length > MAX_HISTORY_ENTRIES ? comments.slice(-MAX_HISTORY_ENTRIES) : comments;
    this.debouncedWrite(file, trimmed);
  }

  getComments(runId: string): import("@ai-workbench/shared").TaskComment[] {
    const file = path.join(this.runDir(runId), "comments.json");
    return readJsonFile(file, []);
  }

  // ---- Final Report ----

  saveReport(runId: string, report: string): void {
    writeJsonFile(path.join(this.runDir(runId), "report.json"), {
      report,
      generatedAt: Date.now(),
    });
  }

  getReport(runId: string): { report: string; generatedAt: number } | null {
    const file = path.join(this.runDir(runId), "report.json");
    return readJsonFile(file, null);
  }

  // ---- Approval Requests ----

  saveApprovalRequest(runId: string, request: ApprovalRequest): void {
    const file = path.join(this.runDir(runId), "approvals.json");
    const approvals = readJsonFile<ApprovalRequest[]>(file, []);
    const idx = approvals.findIndex((a) => a.id === request.id);
    if (idx >= 0) {
      approvals[idx] = request;
    } else {
      approvals.push(request);
    }
    writeJsonFile(file, approvals);
  }

  getPendingApprovals(runId: string): ApprovalRequest[] {
    const file = path.join(this.runDir(runId), "approvals.json");
    const approvals = readJsonFile<ApprovalRequest[]>(file, []);
    return approvals.filter((a) => a.status === "pending");
  }

  updateApprovalRequest(runId: string, approvalId: string, updates: Partial<ApprovalRequest>): void {
    // If runId not provided, search across all runs
    if (!runId) {
      const runs = this.listRuns();
      for (const run of runs) {
        const file = path.join(this.runDir(run.id), "approvals.json");
        const approvals = readJsonFile<ApprovalRequest[]>(file, []);
        const idx = approvals.findIndex((a) => a.id === approvalId);
        if (idx >= 0) {
          Object.assign(approvals[idx], updates);
          writeJsonFile(file, approvals);
          return;
        }
      }
      return;
    }

    const file = path.join(this.runDir(runId), "approvals.json");
    const approvals = readJsonFile<ApprovalRequest[]>(file, []);
    const idx = approvals.findIndex((a) => a.id === approvalId);
    if (idx >= 0) {
      Object.assign(approvals[idx], updates);
      writeJsonFile(file, approvals);
    }
  }

  // ---- Orchestrator Profiles ----

  listProfiles(): OrchestratorProfile[] {
    const file = path.join(this.dataDir, "profiles.json");
    return readJsonFile<OrchestratorProfile[]>(file, []);
  }

  saveProfile(profile: OrchestratorProfile): void {
    const file = path.join(this.dataDir, "profiles.json");
    const profiles = this.listProfiles();
    const idx = profiles.findIndex((p) => p.id === profile.id);
    if (idx >= 0) {
      profiles[idx] = profile;
    } else {
      profiles.push(profile);
    }
    writeJsonFile(file, profiles);
  }

  deleteProfile(id: string): boolean {
    const file = path.join(this.dataDir, "profiles.json");
    const profiles = this.listProfiles();
    const filtered = profiles.filter((p) => p.id !== id);
    if (filtered.length === profiles.length) return false;
    writeJsonFile(file, filtered);
    return true;
  }
}
