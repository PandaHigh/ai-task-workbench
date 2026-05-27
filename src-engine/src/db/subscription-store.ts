import fs from "fs";
import path from "path";
import os from "os";
import type { Subscription } from "@ai-workbench/shared";

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
    console.error(`[subscription-store] Failed to read ${filePath}: ${err instanceof Error ? err.message : err}`);
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

export class SubscriptionStore {
  private filePath: string;

  constructor(customDataDir?: string) {
    const dataDir = customDataDir || getDataDir();
    ensureDir(dataDir);
    this.filePath = path.join(dataDir, "subscriptions.json");
  }

  subscribe(sub: Omit<Subscription, "subscribedAt" | "lastSyncedAt">): Subscription {
    const subs = this.readAll();
    const existing = subs.findIndex((s) => s.remoteUrl === sub.remoteUrl && s.remoteToken === sub.remoteToken);
    if (existing >= 0) return subs[existing];

    const entry: Subscription = {
      ...sub,
      subscribedAt: Date.now(),
      lastSyncedAt: Date.now(),
    };
    subs.push(entry);
    this.writeAll(subs);
    return entry;
  }

  unsubscribe(runId: string): boolean {
    const subs = this.readAll();
    const idx = subs.findIndex((s) => s.runId === runId);
    if (idx < 0) return false;
    subs.splice(idx, 1);
    this.writeAll(subs);
    return true;
  }

  list(): Subscription[] {
    return this.readAll();
  }

  getByRunId(runId: string): Subscription | undefined {
    return this.readAll().find((s) => s.runId === runId);
  }

  updateLastSync(runId: string): void {
    const subs = this.readAll();
    const idx = subs.findIndex((s) => s.runId === runId);
    if (idx >= 0) {
      subs[idx].lastSyncedAt = Date.now();
      this.writeAll(subs);
    }
  }

  private readAll(): Subscription[] {
    return readJsonFile<Subscription[]>(this.filePath, []);
  }

  private writeAll(subs: Subscription[]): void {
    writeJsonFile(this.filePath, subs);
  }
}
