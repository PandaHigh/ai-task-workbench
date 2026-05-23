import { create } from "zustand";
import type { TaskDefinition } from "@ai-workbench/shared";

interface LogEntry {
  id: number;
  timestamp: number;
  level: string;
  source: string;
  message: string;
}

interface EvolutionStore {
  queue: TaskDefinition[];
  activeTaskId: string | null;
  logs: LogEntry[];
  isRunning: boolean;
  setQueue: (queue: TaskDefinition[]) => void;
  setActiveTask: (id: string | null) => void;
  addLog: (log: LogEntry) => void;
  clearLogs: () => void;
  setRunning: (running: boolean) => void;
}

export const useEvolutionStore = create<EvolutionStore>((set) => ({
  queue: [],
  activeTaskId: null,
  logs: [],
  isRunning: false,

  setQueue: (queue) => set({ queue }),
  setActiveTask: (id) => set({ activeTaskId: id }),
  addLog: (log) =>
    set((state) => ({ logs: [...state.logs, log].slice(-500) })),
  clearLogs: () => set({ logs: [] }),
  setRunning: (running) => set({ isRunning: running }),
}));
