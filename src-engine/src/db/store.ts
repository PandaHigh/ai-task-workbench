import fs from "fs";
import path from "path";
import os from "os";
import type {
  ExecutionRun,
  TaskDefinition,
  TaskLog,
  GitCommit,
  LessonLearned,
  ScoreDetails,
  ApprovalRequest,
} from "@ai-workbench/shared";

function getDataDir(): string {
  const platform = os.platform();
  let baseDir: string;
  switch (platform) {
    case "darwin":
      baseDir = path.join(os.homedir(), "Library", "Application Support");
      break;
    case "linux":
      baseDir = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
      break;
    case "win32":
      baseDir = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
      break;
    default:
      baseDir = os.homedir();
  }
  return path.join(baseDir, "ai-task-workbench");
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    }
  } catch (err) {
    console.error(`[store] Failed to read/parse ${filePath}: ${err instanceof Error ? err.message : err}. Using fallback.`);
  }
  return fallback;
}

function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const content = JSON.stringify(data, null, 2);
  const tmpPath = filePath + ".tmp";
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeFileSync(fd, content, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (process.platform === "win32" && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  fs.renameSync(tmpPath, filePath);
}

function cleanupTmpFiles(dir: string): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        cleanupTmpFiles(fullPath);
      } else if (entry.name.endsWith(".tmp")) {
        try {
          fs.unlinkSync(fullPath);
          console.warn(`[store] Cleaned up stale tmp file: ${fullPath}`);
        } catch (cleanupErr) {
          console.warn(`[store] Failed to clean up tmp file ${fullPath}: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`);
        }
      }
    }
  } catch (dirErr) {
    console.warn(`[store] Data directory not found or unreadable: ${dirErr instanceof Error ? dirErr.message : dirErr}`);
  }
}

const MAX_LOG_ENTRIES = 1000;
const MAX_HISTORY_ENTRIES = 500;

export class Store {
  private dataDir: string;
  private runsDir: string;

  constructor(customDataDir?: string) {
    this.dataDir = customDataDir || getDataDir();
    this.runsDir = path.join(this.dataDir, "runs");
    ensureDir(this.runsDir);
    cleanupTmpFiles(this.runsDir);
  }

  // ---- Execution Runs ----

  listRuns(): ExecutionRun[] {
    const indexFile = path.join(this.runsDir, "index.json");
    return readJsonFile<ExecutionRun[]>(indexFile, []);
  }

  getRun(runId: string): ExecutionRun | undefined {
    return this.listRuns().find((r) => r.id === runId);
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
  }

  deleteRun(runId: string): void {
    const runs = this.listRuns().filter((r) => r.id !== runId);
    writeJsonFile(path.join(this.runsDir, "index.json"), runs);
    const runDir = path.join(this.runsDir, runId);
    if (!fs.existsSync(runDir)) return;
    fs.rmSync(runDir, { recursive: true });
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
        Object.entries(updates).filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, v === null ? undefined : v])
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
    logs.push({ ...log, id: logs.length + 1 } as TaskLog);
    // Keep last MAX_LOG_ENTRIES logs in file
    const trimmed = logs.length > MAX_LOG_ENTRIES ? logs.slice(-MAX_LOG_ENTRIES) : logs;
    writeJsonFile(file, trimmed);
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
    commits.push({ ...commit, id: commits.length + 1 } as GitCommit);
    const trimmed = commits.length > MAX_HISTORY_ENTRIES ? commits.slice(-MAX_HISTORY_ENTRIES) : commits;
    writeJsonFile(file, trimmed);
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
    lessons.push({ ...lesson, id: lessons.length + 1 } as LessonLearned);
    const trimmed = lessons.length > MAX_HISTORY_ENTRIES ? lessons.slice(-MAX_HISTORY_ENTRIES) : lessons;
    writeJsonFile(file, trimmed);
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
    writeJsonFile(file, trimmed);
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

  // ---- Activities ----

  appendActivity(runId: string, event: import("@ai-workbench/shared").ActivityEvent): void {
    const file = path.join(this.runDir(runId), "activities.json");
    const activities = readJsonFile<import("@ai-workbench/shared").ActivityEvent[]>(file, []);
    activities.push(event);
    const trimmed = activities.length > MAX_HISTORY_ENTRIES ? activities.slice(-MAX_HISTORY_ENTRIES) : activities;
    writeJsonFile(file, trimmed);
  }

  getActivities(runId: string, limit?: number): import("@ai-workbench/shared").ActivityEvent[] {
    const file = path.join(this.runDir(runId), "activities.json");
    const activities = readJsonFile<import("@ai-workbench/shared").ActivityEvent[]>(file, []);
    return limit ? activities.slice(-limit) : activities;
  }

  // ---- Comments ----

  appendComment(runId: string, comment: import("@ai-workbench/shared").TaskComment): void {
    const file = path.join(this.runDir(runId), "comments.json");
    const comments = readJsonFile<import("@ai-workbench/shared").TaskComment[]>(file, []);
    comments.push(comment);
    writeJsonFile(file, comments);
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
}
