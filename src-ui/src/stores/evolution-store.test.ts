import { describe, it, expect, beforeEach } from "vitest";
import { useEvolutionStore } from "./evolution-store";
import type { TaskDefinition, GitCommit, LessonLearned } from "@ai-workbench/shared";

describe("evolution-store", () => {
  beforeEach(() => {
    useEvolutionStore.getState().reset();
  });

  it("starts with default state", () => {
    const state = useEvolutionStore.getState();
    expect(state.queue).toEqual([]);
    expect(state.activeTaskId).toBeNull();
    expect(state.logs).toEqual([]);
    expect(state.commits).toEqual([]);
    expect(state.lessons).toEqual([]);
    expect(state.isRunning).toBe(false);
  });

  it("setQueue replaces queue", () => {
    const tasks: TaskDefinition[] = [{ id: "t1", runId: "r1", type: "user_defined", content: "test", priority: 1, timeoutMinutes: 60, agentMode: "single", promptJson: "", status: "pending", createdAt: Date.now() }];
    useEvolutionStore.getState().setQueue(tasks);
    expect(useEvolutionStore.getState().queue).toEqual(tasks);
  });

  it("setActiveTask updates active task", () => {
    useEvolutionStore.getState().setActiveTask("t1");
    expect(useEvolutionStore.getState().activeTaskId).toBe("t1");
  });

  it("addLog appends log entries", () => {
    useEvolutionStore.getState().addLog({
      id: 1, timestamp: Date.now(), level: "info", source: "engine", message: "test log",
    });
    expect(useEvolutionStore.getState().logs).toHaveLength(1);
  });

  it("addLog caps at 500 entries", () => {
    for (let i = 0; i < 600; i++) {
      useEvolutionStore.getState().addLog({
        id: i, timestamp: Date.now(), level: "info", source: "engine", message: `log ${i}`,
      });
    }
    expect(useEvolutionStore.getState().logs).toHaveLength(500);
  });

  it("clearLogs empties logs", () => {
    useEvolutionStore.getState().addLog({ id: 1, timestamp: 1, level: "info", source: "engine", message: "x" });
    useEvolutionStore.getState().clearLogs();
    expect(useEvolutionStore.getState().logs).toEqual([]);
  });

  it("setCommits replaces commits", () => {
    const commits: GitCommit[] = [{ id: 1, taskId: "t1", runId: "r1", hash: "abc1234", message: "test", isAiCommit: true, timestamp: Date.now(), additions: 0, deletions: 0 }];
    useEvolutionStore.getState().setCommits(commits);
    expect(useEvolutionStore.getState().commits).toEqual(commits);
  });

  it("setLessons replaces lessons", () => {
    const lessons: LessonLearned[] = [{ id: 1, runId: "r1", category: "failure", lesson: "test", createdAt: Date.now() }];
    useEvolutionStore.getState().setLessons(lessons);
    expect(useEvolutionStore.getState().lessons).toEqual(lessons);
  });

  it("setRunning updates running state", () => {
    useEvolutionStore.getState().setRunning(true);
    expect(useEvolutionStore.getState().isRunning).toBe(true);
    useEvolutionStore.getState().setRunning(false);
    expect(useEvolutionStore.getState().isRunning).toBe(false);
  });

  it("reset clears everything", () => {
    useEvolutionStore.getState().setRunning(true);
    useEvolutionStore.getState().setQueue([{ id: "t1", runId: "r1", type: "user_defined", content: "x", priority: 1, timeoutMinutes: 60, agentMode: "single", promptJson: "", status: "pending", createdAt: 1 }]);
    useEvolutionStore.getState().addLog({ id: 1, timestamp: 1, level: "info", source: "engine", message: "x" });

    useEvolutionStore.getState().reset();

    const state = useEvolutionStore.getState();
    expect(state.queue).toEqual([]);
    expect(state.logs).toEqual([]);
    expect(state.isRunning).toBe(false);
  });
});
