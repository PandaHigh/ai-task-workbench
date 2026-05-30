import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ShareToken } from "@ai-workbench/shared";
import { getDataDir, ensureDir, readJsonFile, writeJsonFile } from "./store-utils.js";

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
