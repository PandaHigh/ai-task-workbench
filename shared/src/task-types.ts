import type {
  TaskStatus,
  RunStatus,
  TaskType,
  LessonCategory,
  GoalStatus,
} from "./enums.js";

export interface TaskDefinition {
  id: string;
  runId: string;
  type: TaskType;
  priority: number;
  content: string;
  timeoutMinutes: number;
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
  errorMessage?: string;
  retryCount?: number;
  lastError?: string;
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
  source?: "remote";
  remoteUrl?: string;
  remoteToken?: string;
  lastSyncedAt?: number;

  // Unified goal state (absorbed from GoalSession)
  goalStatus?: GoalStatus;
  goalBudgetTokens?: number;
  goalTokensUsed?: number;
  goalTimeStartedAt?: number;
  goalTimeElapsedMs?: number;
  goalEvaluationCycles?: number;
  goalLastEvalReason?: string;
  goalEvidence?: string[];
}

export interface ShareToken {
  token: string;
  runId: string;
  label: string;
  createdAt: number;
  expiresAt: number | null;
}

export interface Subscription {
  runId: string;
  remoteUrl: string;
  remoteToken: string;
  remoteRunId: string;
  label: string;
  subscribedAt: number;
  lastSyncedAt: number;
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
  level: string;
  source: string;
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
  promptJson?: string;
}

// ─── Goal types ──────────────────────────────────────────────────────────

export interface GoalEvaluationResult {
  achieved: boolean;
  reason: string;
  evidence: string[];
  progress: number;
  nextSteps: string;
}
