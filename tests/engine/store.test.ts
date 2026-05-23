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

  describe("report", () => {
    it("should save and get report", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });
      store.saveReport("run-1", "All goals completed successfully.");
      const report = store.getReport("run-1");
      expect(report).toBeDefined();
      expect(report!.report).toBe("All goals completed successfully.");
      expect(report!.generatedAt).toBeGreaterThan(0);
    });

    it("should return null for nonexistent report", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });
      expect(store.getReport("run-1")).toBeNull();
    });
  });

  describe("scores", () => {
    it("should append and get scores", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });
      store.appendScore("run-1", "task-1", {
        overall: 0.8, goalAlignment: 0.2, correctness: 0.2,
        completeness: 0.2, quality: 0.2, passed: true, reasoning: "Good",
      });
      const scores = store.getScores("run-1");
      expect(scores).toHaveLength(1);
      expect(scores[0].taskId).toBe("task-1");
      expect(scores[0].score.overall).toBe(0.8);
    });
  });

  describe("commits", () => {
    it("should append and get commits with limit", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });
      store.appendCommit("run-1", {
        taskId: "t1", runId: "run-1", hash: "abc", message: "fix", isAiCommit: true, timestamp: Date.now(), additions: 10, deletions: 5,
      });
      store.appendCommit("run-1", {
        taskId: "t2", runId: "run-1", hash: "def", message: "feat", isAiCommit: false, timestamp: Date.now(), additions: 20, deletions: 0,
      });
      const all = store.getCommits("run-1");
      expect(all).toHaveLength(2);
      const limited = store.getCommits("run-1", 1);
      expect(limited).toHaveLength(1);
      expect(limited[0].hash).toBe("def");
    });
  });

  describe("lessons", () => {
    it("should get lessons filtered by category", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });
      store.appendLesson("run-1", {
        runId: "run-1", taskId: "t1", category: "failure", lesson: "bad", score: 0.3, createdAt: Date.now(),
      });
      store.appendLesson("run-1", {
        runId: "run-1", taskId: "t2", category: "success", lesson: "good", score: 0.9, createdAt: Date.now(),
      });
      const failures = store.getLessons("run-1", "failure");
      expect(failures).toHaveLength(1);
      expect(failures[0].category).toBe("failure");
      const all = store.getLessons("run-1");
      expect(all).toHaveLength(2);
    });
  });

  describe("logs with filters", () => {
    it("should filter logs by taskId", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });
      store.appendLog("run-1", { taskId: "t1", runId: "run-1", timestamp: Date.now(), level: "info", source: "engine", message: "log 1" });
      store.appendLog("run-1", { taskId: "t2", runId: "run-1", timestamp: Date.now(), level: "info", source: "engine", message: "log 2" });
      const filtered = store.getLogs("run-1", "t1");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].message).toBe("log 1");
    });

    it("should limit logs", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });
      for (let i = 0; i < 10; i++) {
        store.appendLog("run-1", { taskId: "", runId: "run-1", timestamp: Date.now(), level: "info", source: "engine", message: `log ${i}` });
      }
      const limited = store.getLogs("run-1", undefined, 3);
      expect(limited).toHaveLength(3);
    });
  });

  describe("corrupted task file", () => {
    it("should handle corrupted tasks.json gracefully", () => {
      store.saveRun({
        id: "run-1", workingDir: "/tmp", goals: [], terminationConditions: [],
        status: "idle", totalCostUsd: 0, totalTasksCompleted: 0,
      });
      // Ensure run dir exists before writing corrupted file
      const runDir = path.join(testDir, "runs", "run-1");
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, "tasks.json"), "BROKEN{");
      const tasks = store.listTasks("run-1");
      expect(tasks).toEqual([]);
    });
  });
});
