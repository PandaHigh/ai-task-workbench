import { create } from "zustand";
import type { TaskDefinition, GitCommit, LessonLearned, AgentProgress, DetectedError, ReviewSuggestion } from "@ai-workbench/shared";

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
  activeTaskId: string | null;
  logs: LogEntry[];
  commits: GitCommit[];
  lessons: LessonLearned[];
  isRunning: boolean;
  agentProgress: Record<string, AgentProgress>;
  errors: DetectedError[];
  suggestions: ReviewSuggestion[];

  setQueue: (queue: TaskDefinition[]) => void;
  setActiveTask: (id: string | null) => void;
  addLog: (log: Omit<LogEntry, "id">) => void;
  setLogs: (logs: LogEntry[]) => void;
  setCommits: (commits: GitCommit[]) => void;
  setLessons: (lessons: LessonLearned[]) => void;
  setRunning: (running: boolean) => void;
  updateAgentProgress: (role: string, progress: AgentProgress) => void;
  addError: (error: DetectedError) => void;
  setErrors: (errors: DetectedError[]) => void;
  addSuggestion: (suggestion: ReviewSuggestion) => void;
  setSuggestions: (suggestions: ReviewSuggestion[]) => void;
  reset: () => void;
}

export const useEvolutionStore = create<EvolutionStore>((set) => ({
  queue: [],
  activeTaskId: null,
  logs: [],
  commits: [],
  lessons: [],
  isRunning: false,
  agentProgress: {},
  errors: [],
  suggestions: [],

  setQueue: (queue) => set({ queue }),
  setActiveTask: (id) => set({ activeTaskId: id }),
  addLog: (log) =>
    set((state) => ({ logs: [...state.logs, { ...log, id: _nextLogId++ }].slice(-500) })),
  setLogs: (logs) => set({ logs: logs.slice(-500) }),
  setCommits: (commits) => set({ commits }),
  setLessons: (lessons) => set({ lessons }),
  setRunning: (running) => set({ isRunning: running }),
  updateAgentProgress: (role, progress) =>
    set((state) => ({ agentProgress: { ...state.agentProgress, [role]: progress } })),
  addError: (error) =>
    set((state) => ({ errors: [...state.errors, error] })),
  setErrors: (errors) => set({ errors }),
  addSuggestion: (suggestion) =>
    set((state) => ({ suggestions: [...state.suggestions, suggestion] })),
  setSuggestions: (suggestions) => set({ suggestions }),
  reset: () => {
    _nextLogId = 1;
    set({ queue: [], activeTaskId: null, logs: [], commits: [], lessons: [], isRunning: false, agentProgress: {}, errors: [], suggestions: [] });
  },
}));
