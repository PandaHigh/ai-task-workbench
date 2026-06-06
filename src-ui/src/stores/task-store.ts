import { create } from "zustand";
import type { ExecutionRun } from "@ai-workbench/shared";
import { engineClient } from "../lib/engine-client";

interface TaskStore {
  tasks: ExecutionRun[];
  activeRunId: string | null;
  loading: boolean;
  loadTasks: () => Promise<void>;
  addTask: (task: ExecutionRun) => void;
  updateTask: (id: string, updates: Partial<ExecutionRun>) => void;
  deleteTask: (id: string) => Promise<void>;
  setActiveRun: (id: string | null) => void;
}

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  activeRunId: null,
  loading: false,

  loadTasks: async () => {
    set({ loading: true });
    try {
      const runs = (await engineClient.call("run.list")) as ExecutionRun[];
      set({ tasks: runs, loading: false });
    } catch (err) {
      console.warn("Failed to load tasks:", err instanceof Error ? err.message : err);
      set({ loading: false });
    }
  },

  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),

  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  deleteTask: async (id) => {
    await engineClient.call("run.delete", { runId: id });
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
  },

  setActiveRun: (id) => set({ activeRunId: id }),
}));
