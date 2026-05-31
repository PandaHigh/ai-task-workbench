import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/engine-client", () => ({
  engineClient: { call: vi.fn() },
}));

import { useTaskStore } from "./task-store";
import { engineClient } from "../lib/engine-client";

describe("task-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTaskStore.setState({ tasks: [], activeRunId: null, loading: false });
  });

  it("should add task", () => {
    useTaskStore.getState().addTask({ id: "r1" } as any);
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useTaskStore.getState().tasks[0].id).toBe("r1");
  });

  it("should update task", () => {
    useTaskStore.getState().addTask({ id: "r1", status: "running" } as any);
    useTaskStore.getState().updateTask("r1", { status: "completed" });
    expect(useTaskStore.getState().tasks[0].status).toBe("completed");
  });

  it("should set active run", () => {
    useTaskStore.getState().setActiveRun("r1");
    expect(useTaskStore.getState().activeRunId).toBe("r1");
  });

  it("should load tasks from engine", async () => {
    (engineClient.call as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "r1" }, { id: "r2" }]);
    await useTaskStore.getState().loadTasks();
    expect(useTaskStore.getState().tasks).toHaveLength(2);
    expect(useTaskStore.getState().loading).toBe(false);
  });

  it("should handle load failure gracefully", async () => {
    (engineClient.call as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
    await useTaskStore.getState().loadTasks();
    expect(useTaskStore.getState().tasks).toHaveLength(0);
    expect(useTaskStore.getState().loading).toBe(false);
  });

  it("should delete task", async () => {
    useTaskStore.getState().addTask({ id: "r1" } as any);
    (engineClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({});
    await useTaskStore.getState().deleteTask("r1");
    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });

  it("should set loading during loadTasks", async () => {
    let resolveLoad: (v: unknown) => void;
    (engineClient.call as ReturnType<typeof vi.fn>).mockReturnValue(new Promise((r) => { resolveLoad = r; }));
    const p = useTaskStore.getState().loadTasks();
    expect(useTaskStore.getState().loading).toBe(true);
    resolveLoad!([]);
    await p;
    expect(useTaskStore.getState().loading).toBe(false);
  });
});
