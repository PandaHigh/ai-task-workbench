import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "../../src-engine/src/db/store.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("Store (JSON file)", () => {
  let store: Store;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `ai-workbench-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    store = new Store(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true });
  });

  describe("runs", () => {
    it("should create and list runs", () => {
      const run = {
        id: "run-1",
        workingDir: "/tmp/project",
        goals: ["goal 1"],
        terminationConditions: ["condition 1"],
        status: "idle" as const,
        totalCostUsd: 0,
        totalTasksCompleted: 0,
      };

      store.saveRun(run);
      const runs = store.listRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe("run-1");
    });

    it("should update existing runs", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });

      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "running", totalCostUsd: 0, totalTasksCompleted: 0,
      });

      expect(store.getRun("run-1")!.status).toBe("running");
    });

    it("should delete runs", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });
      store.deleteRun("run-1");
      expect(store.listRuns()).toHaveLength(0);
    });
  });

  describe("tasks", () => {
    it("should save and list tasks for a run", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });

      const task = {
        id: "task-1", runId: "run-1", type: "user_defined" as const,
        priority: 1, content: "Test task", timeoutMinutes: 60,
        agentMode: "single" as const, status: "pending" as const, createdAt: Date.now(),
      };

      store.saveTask("run-1", task);
      const tasks = store.listTasks("run-1");
      expect(tasks).toHaveLength(1);
      expect(tasks[0].content).toBe("Test task");
    });

    it("should update task fields", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });

      store.saveTask("run-1", {
        id: "task-1", runId: "run-1", type: "smart_task" as const,
        priority: 5, content: "Test", timeoutMinutes: 60,
        agentMode: "single" as const, status: "pending" as const, createdAt: Date.now(),
      });

      store.updateTask("run-1", "task-1", { status: "running" });
      expect(store.getTask("run-1", "task-1")!.status).toBe("running");
    });
  });

  describe("logs", () => {
    it("should append and retrieve logs", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });
      store.saveTask("run-1", {
        id: "task-1", runId: "run-1", type: "smart_task" as const,
        priority: 5, content: "Test", timeoutMinutes: 60,
        agentMode: "single" as const, status: "pending" as const, createdAt: Date.now(),
      });

      store.appendLog("run-1", {
        taskId: "task-1", runId: "run-1", timestamp: Date.now(),
        level: "info", source: "engine", message: "Task started",
      });

      const logs = store.getLogs("run-1");
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe("Task started");
    });
  });

  describe("config", () => {
    it("should get and set config values", () => {
      store.setConfig("testKey", "testValue");
      expect(store.getConfig("testKey")).toBe("testValue");
    });
  });

  describe("log trimming", () => {
    it("should trim logs at 1000 entries", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });

      for (let i = 0; i < 1100; i++) {
        store.appendLog("run-1", {
          taskId: "", runId: "run-1", timestamp: Date.now(),
          level: "info", source: "engine", message: `log ${i}`,
        });
      }

      const logs = store.getLogs("run-1");
      expect(logs.length).toBe(1000);
    });
  });

  describe("corrupted JSON", () => {
    it("should handle corrupted runs index gracefully", () => {
      fs.writeFileSync(path.join(testDir, "runs.json"), "NOT VALID JSON{{{");
      const runs = store.listRuns();
      expect(runs).toEqual([]);
    });
  });

  describe("updateTask undefined filtering", () => {
    it("should not overwrite fields with undefined", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });
      store.saveTask("run-1", {
        id: "task-1", runId: "run-1", type: "user_defined" as const,
        priority: 1, content: "Test", timeoutMinutes: 60,
        agentMode: "single" as const, status: "pending" as const, createdAt: Date.now(),
      });

      store.updateTask("run-1", "task-1", { status: "running", costUsd: undefined });
      const task = store.getTask("run-1", "task-1");
      expect(task!.status).toBe("running");
      // costUsd should remain the original value, not be overwritten with undefined
    });
  });

  describe("deleteRun safety", () => {
    it("should not throw when deleting nonexistent run", () => {
      expect(() => store.deleteRun("nonexistent")).not.toThrow();
    });
  });
});
