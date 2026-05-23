import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useNotifications } from "./useNotifications";
import { useTaskStore } from "../stores/task-store";
import { useEvolutionStore } from "../stores/evolution-store";
import { engineClient } from "../lib/engine-client";
import type { ExecutionRun } from "@ai-workbench/shared";

let notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null = null;

vi.mock("../lib/engine-client", () => ({
  engineClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    call: vi.fn(),
    onNotification: vi.fn().mockImplementation((handler) => {
      notificationHandler = handler;
      return () => { notificationHandler = null; };
    }),
  },
}));

describe("useNotifications", () => {
  beforeEach(() => {
    useTaskStore.setState({ tasks: [], loading: false, activeRunId: null });
    useEvolutionStore.getState().reset();
    notificationHandler = null;
    vi.clearAllMocks();
  });

  it("subscribes to notifications on mount", () => {
    renderHook(() => useNotifications());
    expect(engineClient.onNotification).toHaveBeenCalled();
  });

  it("handles run.status notification - updates task and sets running", async () => {
    const task: ExecutionRun = { id: "run-1", workingDir: "/tmp", goals: [], status: "idle", terminationConditions: [], totalCostUsd: 0, totalTasksCompleted: 0 };
    useTaskStore.setState({ tasks: [task] });

    renderHook(() => useNotifications());

    notificationHandler?.("run.status", { runId: "run-1", status: "running" });

    await waitFor(() => {
      expect(useTaskStore.getState().tasks[0].status).toBe("running");
      expect(useEvolutionStore.getState().isRunning).toBe(true);
    });
  });

  it("handles run.status completed - sets running to false", async () => {
    const task: ExecutionRun = { id: "run-1", workingDir: "/tmp", goals: [], status: "running", terminationConditions: [], totalCostUsd: 0, totalTasksCompleted: 0 };
    useTaskStore.setState({ tasks: [task] });
    useEvolutionStore.getState().setRunning(true);

    renderHook(() => useNotifications());

    notificationHandler?.("run.status", { runId: "run-1", status: "completed", report: "All done" });

    await waitFor(() => {
      expect(useTaskStore.getState().tasks[0].status).toBe("completed");
      expect(useEvolutionStore.getState().isRunning).toBe(false);
    });
  });

  it("handles run.status failed - sets running to false", async () => {
    useEvolutionStore.getState().setRunning(true);

    renderHook(() => useNotifications());

    notificationHandler?.("run.status", { runId: "run-1", status: "failed" });

    await waitFor(() => {
      expect(useEvolutionStore.getState().isRunning).toBe(false);
    });
  });

  it("handles task.status notification - adds log entry", async () => {
    renderHook(() => useNotifications());

    notificationHandler?.("task.status", { taskId: "task-123456789", status: "failed" });

    await waitFor(() => {
      const logs = useEvolutionStore.getState().logs;
      expect(logs.length).toBe(1);
      expect(logs[0].level).toBe("error");
      expect(logs[0].message).toContain("task-1");
    });
  });

  it("handles task.progress notification - adds info log", async () => {
    renderHook(() => useNotifications());

    notificationHandler?.("task.progress", { taskId: "task-1", content: "Running tests..." });

    await waitFor(() => {
      const logs = useEvolutionStore.getState().logs;
      expect(logs.length).toBe(1);
      expect(logs[0].message).toBe("Running tests...");
      expect(logs[0].source).toBe("cc");
    });
  });

  it("handles task.scored notification - adds score log", async () => {
    renderHook(() => useNotifications());

    notificationHandler?.("task.scored", {
      taskId: "task-abc",
      score: { overall: 0.85, passed: true, reasoning: "Good quality" },
    });

    await waitFor(() => {
      const logs = useEvolutionStore.getState().logs;
      expect(logs.length).toBe(1);
      expect(logs[0].message).toContain("85%");
      expect(logs[0].message).toContain("PASS");
      expect(logs[0].message).toContain("Good quality");
    });
  });

  it("handles task.scored notification - fail case", async () => {
    renderHook(() => useNotifications());

    notificationHandler?.("task.scored", {
      taskId: "task-abc",
      score: { overall: 0.3, passed: false },
    });

    await waitFor(() => {
      const logs = useEvolutionStore.getState().logs;
      expect(logs[0].message).toContain("30%");
      expect(logs[0].message).toContain("FAIL");
      expect(logs[0].level).toBe("warn");
    });
  });

  it("handles git.commit notification - adds commit log", async () => {
    renderHook(() => useNotifications());

    notificationHandler?.("git.commit", { hash: "abc1234567", message: "Fix bug #42" });

    await waitFor(() => {
      const logs = useEvolutionStore.getState().logs;
      expect(logs.length).toBe(1);
      expect(logs[0].message).toContain("abc1234");
      expect(logs[0].message).toContain("Fix bug #42");
      expect(logs[0].source).toBe("git");
    });
  });

  it("handles queue.updated notification - replaces queue", async () => {
    renderHook(() => useNotifications());

    const queue = [
      { id: "t1", content: "Task 1" },
      { id: "t2", content: "Task 2" },
    ];

    notificationHandler?.("queue.updated", { queue });

    await waitFor(() => {
      expect(useEvolutionStore.getState().queue).toEqual(queue);
    });
  });

  it("handles log.entry notification - adds generic log", async () => {
    renderHook(() => useNotifications());

    notificationHandler?.("log.entry", {
      level: "warn",
      source: "engine",
      message: "Budget warning",
    });

    await waitFor(() => {
      const logs = useEvolutionStore.getState().logs;
      expect(logs.length).toBe(1);
      expect(logs[0].message).toBe("Budget warning");
    });
  });

  it("unsubscribes on unmount", () => {
    const unsub = vi.fn();
    vi.mocked(engineClient.onNotification).mockReturnValue(unsub);

    const { unmount } = renderHook(() => useNotifications());
    unmount();

    expect(unsub).toHaveBeenCalled();
  });
});
