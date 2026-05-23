import type {
  TaskStatus,
  RunStatus,
  TaskType,
  AgentMode,
  LessonCategory,
  LogLevel,
  LogSource,
} from "./enums.js";

export interface TaskDefinition {
  id: string;
  runId: string;
  type: TaskType;
  priority: number;
  content: string;
  timeoutMinutes: number;
  agentMode: AgentMode;
  promptJson: string;
  status: TaskStatus;
  sessionId?: string;
  score?: number;
  scoreDetails?: ScoreDetails;
  result?: string;
  revertCommitHash?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  costUsd?: number;
}

export interface ExecutionRun {
  id: string;
  workingDir: string;
  goals: string[];
  terminationConditions: string[];
  status: RunStatus;
  startedAt?: number;
  completedAt?: number;
  totalCostUsd: number;
  totalTasksCompleted: number;
  finalReport?: string;
}

export interface TaskQueueEntry {
  id: number;
  runId: string;
  taskId: string;
  position: number;
  isUserPriority: boolean;
}

export interface TaskLog {
  id: number;
  taskId: string;
  runId: string;
  timestamp: number;
  level: LogLevel;
  source: LogSource;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface GitCommit {
  id: number;
  taskId: string;
  runId: string;
  hash: string;
  message: string;
  isAiCommit: boolean;
  timestamp: number;
  filesChanged?: string[];
  additions: number;
  deletions: number;
}

export interface LessonLearned {
  id: number;
  runId: string;
  taskId?: string;
  category: LessonCategory;
  lesson: string;
  context?: Record<string, unknown>;
  score?: number;
  createdAt: number;
}

export interface ScoreDetails {
  overall: number;
  goalAlignment: number;
  correctness: number;
  completeness: number;
  quality: number;
  passed: boolean;
  reasoning: string;
}

export interface TaskContext {
  workingDir: string;
  goals: string[];
  terminationConditions: string[];
  lastTenCommits: GitCommitSummary[];
  nextFiveTasks: TaskDefinition[];
  lessonsLearned: LessonLearned[];
  sessionId?: string;
}

export interface GitCommitSummary {
  hash: string;
  message: string;
  timestamp: number;
  isAiCommit: boolean;
}

export interface GoalEvaluation {
  isComplete: boolean;
  progressReport: string;
  completedGoals: string[];
  remainingGoals: string[];
  overallProgress: number;
}

export interface SmartTask {
  content: string;
  priority: number;
  reasoning: string;
}

export interface CreateRunParams {
  workingDir: string;
  goals: string[];
  terminationConditions: string[];
  tasks?: CreateTaskParams[];
}

export interface CreateTaskParams {
  content: string;
  type: TaskType;
  priority?: number;
  timeoutMinutes?: number;
  agentMode?: AgentMode;
  promptJson?: string;
}
