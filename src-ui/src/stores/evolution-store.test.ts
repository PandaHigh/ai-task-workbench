import { describe, it, expect, beforeEach } from "vitest";
import { useEvolutionStore } from "./evolution-store";

describe("evolution-store", () => {
  beforeEach(() => {
    useEvolutionStore.getState().reset();
  });

  describe("initial state", () => {
    it("should have default values", () => {
      const s = useEvolutionStore.getState();
      expect(s.queue).toEqual([]);
      expect(s.activeTaskId).toBeNull();
      expect(s.logs).toEqual([]);
      expect(s.commits).toEqual([]);
      expect(s.lessons).toEqual([]);
      expect(s.isRunning).toBe(false);
      expect(s.agentProgress).toEqual({});
      expect(s.errors).toEqual([]);
      expect(s.suggestions).toEqual([]);
    });
  });

  describe("addLog with auto-increment ID", () => {
    it("should auto-assign sequential IDs", () => {
      useEvolutionStore.getState().addLog({ timestamp: 100, level: "info", source: "engine", message: "msg1" });
      useEvolutionStore.getState().addLog({ timestamp: 100, level: "info", source: "engine", message: "msg2" });

      const logs = useEvolutionStore.getState().logs;
      expect(logs).toHaveLength(2);
      expect(logs[0].id).toBe(1);
      expect(logs[1].id).toBe(2);
    });

    it("should not use caller-provided id", () => {
      useEvolutionStore.getState().addLog({ id: 999, timestamp: 100, level: "info", source: "engine", message: "msg" } as never);

      const logs = useEvolutionStore.getState().logs;
      expect(logs[0].id).toBe(1);
    });

    it("should cap logs at 500", () => {
      for (let i = 0; i < 502; i++) {
        useEvolutionStore.getState().addLog({ timestamp: i, level: "info", source: "engine", message: `msg${i}` });
      }
      expect(useEvolutionStore.getState().logs).toHaveLength(500);
    });
  });

  describe("errors", () => {
    it("should add errors", () => {
      const error = { id: "e1", message: "err", severity: "critical" as const, category: "runtime" as const, runId: "r1", timestamp: 1 };
      useEvolutionStore.getState().addError(error);
      expect(useEvolutionStore.getState().errors).toHaveLength(1);
      expect(useEvolutionStore.getState().errors[0].id).toBe("e1");
    });

    it("should set errors", () => {
      const errors = [
        { id: "e1", message: "err1", severity: "critical" as const, category: "runtime" as const, runId: "r1", timestamp: 1 },
        { id: "e2", message: "err2", severity: "warning" as const, category: "syntax" as const, runId: "r1", timestamp: 2 },
      ];
      useEvolutionStore.getState().setErrors(errors);
      expect(useEvolutionStore.getState().errors).toHaveLength(2);
    });
  });

  describe("suggestions", () => {
    it("should add suggestions", () => {
      const suggestion = { id: "s1", summary: "review", score: 0.8, issues: [], status: "pending" as const, runId: "r1", taskId: "t1", createdAt: 1 };
      useEvolutionStore.getState().addSuggestion(suggestion);
      expect(useEvolutionStore.getState().suggestions).toHaveLength(1);
    });

    it("should set suggestions", () => {
      const suggestions = [
        { id: "s1", summary: "review 1", score: 0.7, issues: [], status: "pending" as const, runId: "r1", taskId: "t1", createdAt: 1 },
        { id: "s2", summary: "review 2", score: 0.9, issues: [], status: "fix_created" as const, runId: "r1", taskId: "t2", createdAt: 2 },
      ];
      useEvolutionStore.getState().setSuggestions(suggestions);
      expect(useEvolutionStore.getState().suggestions).toHaveLength(2);
    });
  });

  describe("agentProgress", () => {
    it("should update agent progress", () => {
      const progress = { runId: "r1", taskId: "t1", role: "developer", progress: 50, phase: "coding", files: [], message: "working", timestamp: 1 };
      useEvolutionStore.getState().updateAgentProgress("developer", progress);
      expect(useEvolutionStore.getState().agentProgress.developer.phase).toBe("coding");
    });
  });

  describe("reset", () => {
    it("should clear all state", () => {
      const store = useEvolutionStore.getState();
      store.addLog({ timestamp: 1, level: "info", source: "engine", message: "msg" });
      store.addError({ id: "e1", message: "err", severity: "critical", category: "runtime", runId: "r1", timestamp: 1 });
      store.addSuggestion({ id: "s1", summary: "rev", score: 0.5, issues: [], status: "pending", runId: "r1", taskId: "t1", createdAt: 1 });
      store.setRunning(true);
      store.setQueue([{ id: "t1", content: "task", type: "user_defined", priority: 5, status: "pending", timeoutMinutes: 60, runId: "r1" }]);

      store.reset();

      const s = useEvolutionStore.getState();
      expect(s.logs).toEqual([]);
      expect(s.errors).toEqual([]);
      expect(s.suggestions).toEqual([]);
      expect(s.isRunning).toBe(false);
      expect(s.queue).toEqual([]);
    });

    it("should reset log ID counter", () => {
      useEvolutionStore.getState().addLog({ timestamp: 1, level: "info", source: "engine", message: "msg" });
      expect(useEvolutionStore.getState().logs[0].id).toBe(1);

      useEvolutionStore.getState().reset();

      useEvolutionStore.getState().addLog({ timestamp: 2, level: "info", source: "engine", message: "msg" });
      expect(useEvolutionStore.getState().logs[0].id).toBe(1);
    });
  });
});
