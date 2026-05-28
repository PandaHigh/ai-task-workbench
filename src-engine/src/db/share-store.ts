import fs from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import type { ShareToken } from "@ai-workbench/shared";

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
    console.error(`[share-store] Failed to read ${filePath}: ${err instanceof Error ? err.message : err}`);
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

export class ShareStore {
  private filePath: string;

  constructor(customDataDir?: string) {
    const dataDir = customDataDir || getDataDir();
    ensureDir(dataDir);
    this.filePath = path.join(dataDir, "shares.json");
  }

  create(runId: string, label?: string, expiresAt?: number | null): ShareToken {
    const shares = this.readAll();
    const token: ShareToken = {
      token: randomUUID(),
      runId,
      label: label || "",
      createdAt: Date.now(),
      expiresAt: expiresAt ?? null,
    };
    shares.push(token);
    this.writeAll(shares);
    return token;
  }

  list(runId?: string): ShareToken[] {
    const shares = this.readAll();
    if (runId) return shares.filter((s) => s.runId === runId);
    return shares;
  }

  getByToken(token: string): ShareToken | undefined {
    const shares = this.readAll();
    const found = shares.find((s) => s.token === token);
    if (!found) return undefined;
    if (found.expiresAt !== null && Date.now() > found.expiresAt) {
      this.revoke(token);
      return undefined;
    }
    return found;
  }

  revoke(token: string): boolean {
    const shares = this.readAll();
    const idx = shares.findIndex((s) => s.token === token);
    if (idx < 0) return false;
    shares.splice(idx, 1);
    this.writeAll(shares);
    return true;
  }

  revokeByRunId(runId: string): number {
    const shares = this.readAll();
    const remaining = shares.filter((s) => s.runId !== runId);
    const removed = shares.length - remaining.length;
    if (removed > 0) this.writeAll(remaining);
    return removed;
  }

  cleanup(): number {
    const shares = this.readAll();
    const now = Date.now();
    const remaining = shares.filter((s) => s.expiresAt === null || now <= s.expiresAt);
    const removed = shares.length - remaining.length;
    if (removed > 0) this.writeAll(remaining);
    return removed;
  }

  private readAll(): ShareToken[] {
    return readJsonFile<ShareToken[]>(this.filePath, []);
  }

  private writeAll(shares: ShareToken[]): void {
    writeJsonFile(this.filePath, shares);
  }
}
