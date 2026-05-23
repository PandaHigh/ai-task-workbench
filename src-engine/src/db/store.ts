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
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    }
  } catch {
    // corrupted file, return fallback
  }
  return fallback;
}

function writeJsonFile(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const content = JSON.stringify(data, null, 2);
  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}

export class Store {
  private dataDir: string;
  private runsDir: string;

  constructor(customDataDir?: string) {
    this.dataDir = customDataDir || getDataDir();
    this.runsDir = path.join(this.dataDir, "runs");
    ensureDir(this.runsDir);
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
    if (fs.existsSync(runDir)) {
      fs.rmSync(runDir, { recursive: true });
    }
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
      tasks[idx] = { ...tasks[idx], ...updates };
      writeJsonFile(path.join(this.runDir(runId), "tasks.json"), tasks);
    }
  }

  // ---- Logs ----

  appendLog(runId: string, log: Omit<TaskLog, "id">): void {
    const file = path.join(this.runDir(runId), "logs.json");
    const logs = readJsonFile<TaskLog[]>(file, []);
    logs.push({ ...log, id: logs.length + 1 } as TaskLog);
    // Keep last 1000 logs in file
    const trimmed = logs.slice(-1000);
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
    writeJsonFile(file, commits);
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
    writeJsonFile(file, lessons);
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
    writeJsonFile(file, scores);
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
}
