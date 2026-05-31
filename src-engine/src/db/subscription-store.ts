import path from "path";
import type { Subscription } from "@ai-workbench/shared";
import { getDataDir, ensureDir, readJsonFile, writeJsonFile } from "./store-utils.js";

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
