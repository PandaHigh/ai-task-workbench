import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTaskStore } from "./task-store";
import { engineClient } from "../lib/engine-client";
import type { ExecutionRun } from "@ai-workbench/shared";

vi.mock("../lib/engine-client", () => ({
  engineClient: {
    call: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    onNotification: vi.fn().mockReturnValue(() => {}),
  },
}));

describe("task-store", () => {
  beforeEach(() => {
    useTaskStore.setState({
      tasks: [],
      activeRunId: null,
      loading: false,
    });
    vi.clearAllMocks();
  });

  it("starts with empty state", () => {
    const state = useTaskStore.getState();
    expect(state.tasks).toEqual([]);
    expect(state.activeRunId).toBeNull();
    expect(state.loading).toBe(false);
  });

  it("loadTasks sets loading and populates tasks on success", async () => {
    const mockRuns: ExecutionRun[] = [
      { id: "run-1", workingDir: "/a", goals: ["g1"], status: "idle", terminationConditions: [], totalCostUsd: 0, totalTasksCompleted: 0 },
    ];
    vi.mocked(engineClient.call).mockResolvedValue(mockRuns);

    await useTaskStore.getState().loadTasks();

    expect(engineClient.call).toHaveBeenCalledWith("run.list");
    const state = useTaskStore.getState();
    expect(state.loading).toBe(false);
    expect(state.tasks).toEqual(mockRuns);
  });

  it("loadTasks handles errors gracefully", async () => {
    vi.mocked(engineClient.call).mockRejectedValue(new Error("connection failed"));

    await useTaskStore.getState().loadTasks();

    const state = useTaskStore.getState();
    expect(state.loading).toBe(false);
    expect(state.tasks).toEqual([]);
  });

  it("addTask appends a task", () => {
    const task: ExecutionRun = { id: "run-2", workingDir: "/b", goals: ["g2"], status: "running", terminationConditions: [], totalCostUsd: 0, totalTasksCompleted: 0 };
    useTaskStore.getState().addTask(task);

    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useTaskStore.getState().tasks[0].id).toBe("run-2");
  });

  it("updateTask merges partial updates", () => {
    useTaskStore.setState({
      tasks: [{ id: "run-1", workingDir: "/a", goals: ["g1"], status: "idle", terminationConditions: [], totalCostUsd: 0, totalTasksCompleted: 0 }],
    });

    useTaskStore.getState().updateTask("run-1", { status: "running" });

    expect(useTaskStore.getState().tasks[0].status).toBe("running");
    expect(useTaskStore.getState().tasks[0].workingDir).toBe("/a");
  });

  it("removeTask removes by id", () => {
    useTaskStore.setState({
      tasks: [
        { id: "run-1", workingDir: "/a", goals: [], status: "idle", terminationConditions: [], totalCostUsd: 0, totalTasksCompleted: 0 },
        { id: "run-2", workingDir: "/b", goals: [], status: "idle", terminationConditions: [], totalCostUsd: 0, totalTasksCompleted: 0 },
      ],
    });

    useTaskStore.getState().removeTask("run-1");

    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useTaskStore.getState().tasks[0].id).toBe("run-2");
  });

  it("deleteTask calls RPC and removes task", async () => {
    useTaskStore.setState({
      tasks: [{ id: "run-1", workingDir: "/a", goals: [], status: "idle", terminationConditions: [], totalCostUsd: 0, totalTasksCompleted: 0 }],
    });
    vi.mocked(engineClient.call).mockResolvedValue(undefined);

    await useTaskStore.getState().deleteTask("run-1");

    expect(engineClient.call).toHaveBeenCalledWith("run.delete", { runId: "run-1" });
    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  it("setActiveRun updates activeRunId", () => {
    useTaskStore.getState().setActiveRun("run-1");
    expect(useTaskStore.getState().activeRunId).toBe("run-1");

    useTaskStore.getState().setActiveRun(null);
    expect(useTaskStore.getState().activeRunId).toBeNull();
  });
});
