import { create } from "zustand";
import type { TaskDefinition, GitCommit, LessonLearned, AgentProgress } from "@ai-workbench/shared";

interface LogEntry {
  id: number;
  timestamp: number;
  level: string;
  source: string;
  message: string;
}

let _nextLogId = 1;

interface EvolutionStore {
  queue: TaskDefinition[];
  activeTaskIds: string[];
  logs: LogEntry[];
  commits: GitCommit[];
  lessons: LessonLearned[];
  isRunning: boolean;
  agentProgress: Record<string, AgentProgress>;

  setQueue: (queue: TaskDefinition[]) => void;
  addActiveTask: (id: string) => void;
  removeActiveTask: (id: string) => void;
  addLog: (log: Omit<LogEntry, "id">) => void;
  setLogs: (logs: LogEntry[]) => void;
  setCommits: (commits: GitCommit[]) => void;
  setLessons: (lessons: LessonLearned[]) => void;
  setRunning: (running: boolean) => void;
  updateAgentProgress: (role: string, progress: AgentProgress) => void;
  reset: () => void;
}

export const useEvolutionStore = create<EvolutionStore>((set) => ({
  queue: [],
  activeTaskIds: [],
  logs: [],
  commits: [],
  lessons: [],
  isRunning: false,
  agentProgress: {},

  setQueue: (queue) => set({ queue }),
  addActiveTask: (id) =>
    set((state) => ({
      activeTaskIds: state.activeTaskIds.includes(id) ? state.activeTaskIds : [...state.activeTaskIds, id],
    })),
  removeActiveTask: (id) =>
    set((state) => ({
      activeTaskIds: state.activeTaskIds.filter((tid) => tid !== id),
    })),
  addLog: (log) =>
    set((state) => ({ logs: [...state.logs, { ...log, id: _nextLogId++ }].slice(-1000) })),
  setLogs: (logs) => set({ logs: logs.slice(-1000) }),
  setCommits: (commits) => set({ commits }),
  setLessons: (lessons) => set({ lessons }),
  setRunning: (running) => set({ isRunning: running }),
  updateAgentProgress: (role, progress) =>
    set((state) => ({ agentProgress: { ...state.agentProgress, [role]: progress } })),
  reset: () => {
    _nextLogId = 1;
    set({ queue: [], activeTaskIds: [], logs: [], commits: [], lessons: [], isRunning: false, agentProgress: {} });
  },
}));
