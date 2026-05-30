import fs from "fs";
import path from "path";
import os from "os";

export function getDataDir(): string {
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

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJsonFile<T>(filePath: string, fallback: T, tag = "store"): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    }
  } catch (err) {
    console.error(`[${tag}] Failed to read/parse ${filePath}: ${err instanceof Error ? err.message : err}. Using fallback.`);
  }
  return fallback;
}

export function writeJsonFile(filePath: string, data: unknown): void {
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

export function cleanupTmpFiles(dir: string): void {
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
