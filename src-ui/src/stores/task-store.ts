import { create } from "zustand";
import type { ExecutionRun, TaskDefinition } from "@ai-workbench/shared";

interface TaskStore {
  tasks: ExecutionRun[];
  activeRunId: string | null;
  addTask: (task: ExecutionRun) => void;
  updateTask: (id: string, updates: Partial<ExecutionRun>) => void;
  removeTask: (id: string) => void;
  setActiveRun: (id: string | null) => void;
}

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  activeRunId: null,

  addTask: (task) =>
    set((state) => ({ tasks: [...state.tasks, task] })),

  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  removeTask: (id) =>
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) })),

  setActiveRun: (id) => set({ activeRunId: id }),
}));
