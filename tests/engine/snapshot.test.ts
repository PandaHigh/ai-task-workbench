import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { SnapshotManager } from "../../src-engine/src/lib/snapshot.js";

describe("SnapshotManager", () => {
  let testDir: string;
  let workingDir: string;
  let manager: SnapshotManager;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    workingDir = path.join(testDir, "work");
    fs.mkdirSync(workingDir, { recursive: true });
    manager = new SnapshotManager(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("should create a snapshot archive", async () => {
      // Write a test file
      fs.writeFileSync(path.join(workingDir, "test.txt"), "hello world");

      const meta = await manager.create("run-1", "task-1", "pre", workingDir);

      expect(meta.id).toContain("run-1");
      expect(meta.id).toContain("task-1");
      expect(meta.id).toContain("pre");
      expect(meta.runId).toBe("run-1");
      expect(meta.taskId).toBe("task-1");
      expect(meta.type).toBe("pre");
      expect(meta.sizeBytes).toBeGreaterThan(0);
    });

    it("should create pre and post snapshots", async () => {
      fs.writeFileSync(path.join(workingDir, "data.json"), "{}");

      const pre = await manager.create("run-2", "task-1", "pre", workingDir);
      const post = await manager.create("run-2", "task-1", "post", workingDir);

      expect(pre.type).toBe("pre");
      expect(post.type).toBe("post");
      expect(pre.id).not.toBe(post.id);
    });
  });

  describe("listSnapshots", () => {
    it("should return empty array for run with no snapshots", () => {
      expect(manager.listSnapshots("empty-run")).toEqual([]);
    });

    it("should list created snapshots", async () => {
      fs.writeFileSync(path.join(workingDir, "file.txt"), "content");
      await manager.create("run-3", "task-1", "pre", workingDir);
      await manager.create("run-3", "task-2", "pre", workingDir);

      const list = manager.listSnapshots("run-3");
      expect(list).toHaveLength(2);
    });
  });

  describe("restore", () => {
    it("should restore files from a snapshot", async () => {
      // Create initial content
      fs.writeFileSync(path.join(workingDir, "original.txt"), "original content");
      const meta = await manager.create("run-4", "task-1", "pre", workingDir);

      // Modify files
      fs.writeFileSync(path.join(workingDir, "original.txt"), "modified content");
      fs.writeFileSync(path.join(workingDir, "new-file.txt"), "new file");

      // Restore
      const restoreDir = path.join(testDir, "restored");
      fs.mkdirSync(restoreDir, { recursive: true });
      await manager.restore("run-4", meta.id, restoreDir);

      // Check restored content
      const restoredContent = fs.readFileSync(path.join(restoreDir, "original.txt"), "utf-8");
      expect(restoredContent).toBe("original content");
    });
  });

  describe("trim", () => {
    it("should trim snapshots beyond max limit", async () => {
      fs.writeFileSync(path.join(workingDir, "data.txt"), "x".repeat(100));

      // Create 12 snapshots (max is 10)
      for (let i = 0; i < 12; i++) {
        await manager.create("run-5", `task-${i}`, "pre", workingDir);
      }

      const list = manager.listSnapshots("run-5");
      expect(list.length).toBeLessThanOrEqual(10);
    });
  });
});
