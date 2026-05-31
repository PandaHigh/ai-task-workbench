import { execFile } from "child_process";
import { mkdirSync, readdirSync, rmSync } from "fs";
import path from "path";

export interface SnapshotMeta {
  id: string;
  runId: string;
  taskId: string;
  type: "pre" | "post";
  timestamp: number;
  sizeBytes: number;
}

const MAX_SNAPSHOTS_PER_RUN = 10;

export class SnapshotManager {
  private snapshotsDir: string;

  constructor(dataDir: string) {
    this.snapshotsDir = path.join(dataDir, "snapshots");
    mkdirSync(this.snapshotsDir, { recursive: true });
  }

  async create(
    runId: string,
    taskId: string,
    type: "pre" | "post",
    workingDir: string,
  ): Promise<SnapshotMeta> {
    const id = `${runId}-${taskId.slice(0, 8)}-${type}-${Date.now()}`;
    const runSnapshotDir = path.join(this.snapshotsDir, runId);
    mkdirSync(runSnapshotDir, { recursive: true });
    const archivePath = path.join(runSnapshotDir, `${id}.tar.gz`);

    const sizeBytes = await this.createTarGz(workingDir, archivePath);

    // Enforce max snapshots per run
    this.trimSnapshots(runId);

    return { id, runId, taskId, type, timestamp: Date.now(), sizeBytes };
  }

  async restore(
    runId: string,
    snapshotId: string,
    targetDir: string,
  ): Promise<void> {
    const archivePath = path.join(this.snapshotsDir, runId, `${snapshotId}.tar.gz`);
    await this.extractTarGz(archivePath, targetDir);
  }

  listSnapshots(runId: string): string[] {
    const runDir = path.join(this.snapshotsDir, runId);
    try {
      return readdirSync(runDir)
        .filter((f) => f.endsWith(".tar.gz"))
        .map((f) => f.replace(".tar.gz", ""));
    } catch {
      return [];
    }
  }

  private trimSnapshots(runId: string): void {
    const runDir = path.join(this.snapshotsDir, runId);
    try {
      const files = readdirSync(runDir)
        .filter((f) => f.endsWith(".tar.gz"))
        .sort();
      while (files.length > MAX_SNAPSHOTS_PER_RUN) {
        const oldest = files.shift();
        if (oldest) {
          rmSync(path.join(runDir, oldest));
        }
      }
    } catch {
      // Directory may not exist yet
    }
  }

  private createTarGz(sourceDir: string, archivePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      execFile(
        "tar",
        ["-czf", archivePath, "-C", sourceDir, "--exclude=node_modules", "--exclude=.git", "."],
        (err) => {
          if (err) return reject(err);
          try {
            const { statSync } = require("fs");
            resolve(statSync(archivePath).size);
          } catch {
            resolve(0);
          }
        },
      );
    });
  }

  private extractTarGz(archivePath: string, targetDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        "tar",
        ["-xzf", archivePath, "-C", targetDir],
        (err) => {
          if (err) return reject(err);
          resolve();
        },
      );
    });
  }
}
