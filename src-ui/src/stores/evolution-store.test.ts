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
      expect(s.activeTaskIds).toEqual([]);
      expect(s.logs).toEqual([]);
      expect(s.commits).toEqual([]);
      expect(s.lessons).toEqual([]);
      expect(s.isRunning).toBe(false);
      expect(s.agentProgress).toEqual({});
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

    it("should cap logs at 1000", () => {
      for (let i = 0; i < 1002; i++) {
        useEvolutionStore.getState().addLog({ timestamp: i, level: "info", source: "engine", message: `msg${i}` });
      }
      expect(useEvolutionStore.getState().logs).toHaveLength(1000);
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
      store.setRunning(true);
      store.setQueue([{ id: "t1", content: "task", type: "user_defined", priority: 5, status: "pending", timeoutMinutes: 60, runId: "r1", promptJson: "", createdAt: Date.now() }]);

      store.reset();

      const s = useEvolutionStore.getState();
      expect(s.logs).toEqual([]);
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
