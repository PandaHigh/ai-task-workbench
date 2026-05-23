import { create } from "zustand";
import type { TaskDefinition, GitCommit, LessonLearned } from "@ai-workbench/shared";

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
  commits: GitCommit[];
  lessons: LessonLearned[];
  isRunning: boolean;

  setQueue: (queue: TaskDefinition[]) => void;
  setActiveTask: (id: string | null) => void;
  addLog: (log: LogEntry) => void;
  clearLogs: () => void;
  setCommits: (commits: GitCommit[]) => void;
  setLessons: (lessons: LessonLearned[]) => void;
  setRunning: (running: boolean) => void;
  reset: () => void;
}

export const useEvolutionStore = create<EvolutionStore>((set) => ({
  queue: [],
  activeTaskId: null,
  logs: [],
  commits: [],
  lessons: [],
  isRunning: false,

  setQueue: (queue) => set({ queue }),
  setActiveTask: (id) => set({ activeTaskId: id }),
  addLog: (log) =>
    set((state) => ({ logs: [...state.logs, log].slice(-500) })),
  clearLogs: () => set({ logs: [] }),
  setCommits: (commits) => set({ commits }),
  setLessons: (lessons) => set({ lessons }),
  setRunning: (running) => set({ isRunning: running }),
  reset: () => set({ queue: [], activeTaskId: null, logs: [], commits: [], lessons: [], isRunning: false }),
}));
