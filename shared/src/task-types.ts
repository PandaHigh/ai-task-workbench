import type {
  TaskStatus,
  RunStatus,
  TaskType,
  LessonCategory,
  GoalStatus,
  CheckpointType,
  ApprovalStatus,
  AutonomyLevel,
  TaskPhase,
  UserRole,
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
  assignedRoleId?: string;
  pipelinePhases?: PhaseRecord[];
  pipelineIterations?: number;
  dependsOn?: string[];
  condition?: string;
  modelHint?: string;
  branchName?: string;
  worktreePath?: string;
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

  // Approval system
  approvalTimeoutMs?: number;
  autonomyLevel?: AutonomyLevel;
  maxConcurrentTasks?: number;

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
  useDefaultLocation?: boolean;
}

export interface CreateTaskParams {
  content: string;
  type: TaskType;
  priority?: number;
  timeoutMinutes?: number;
  promptJson?: string;
  dependsOn?: string[];
  condition?: string;
}

// ─── Goal types ──────────────────────────────────────────────────────────

export interface GoalEvaluationResult {
  achieved: boolean;
  reason: string;
  evidence: string[];
  progress: number;
  nextSteps: string;
}

// ─── Approval system ─────────────────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  runId: string;
  taskId?: string;
  checkpointType: CheckpointType;
  status: ApprovalStatus;
  createdAt: number;
  resolvedAt?: number;
  timeoutMs?: number;
  autoAction: "approve" | "reject";
  summary: string;
  contextData: Record<string, unknown>;
  decision?: {
    action: "approve" | "reject" | "modify";
    instructions?: string;
    modifications?: Record<string, unknown>;
  };
}

// ─── Pipeline types ─────────────────────────────────────────────────────

export interface ExecutionPlan {
  understanding: string;
  steps: string[];
  targetFiles: string[];
  risks: string[];
  testStrategy: string;
}

export interface TestResult {
  testsWritten: string[];
  allPassed: boolean;
  failures: string[];
  coverage: string;
}

export interface ReviewIssue {
  severity: "critical" | "major" | "minor";
  file: string;
  line?: number;
  description: string;
  suggestion: string;
}

export interface ReviewResult {
  approved: boolean;
  score: number;
  issues: ReviewIssue[];
  summary: string;
}

export interface PhaseRecord {
  phase: TaskPhase;
  durationMs: number;
  costUsd: number;
  turns: number;
  iteration: number;
}

// ─── Agent Progress ──────────────────────────────────────────

export interface AgentProgress {
  runId: string;
  taskId: string;
  role: string;
  progress: number;
  phase: string;
  files: string[];
  message: string;
  timestamp: number;
}

// ─── Orchestrator Profile ───────────────────────────────────

export interface OrchestratorProfile {
  id: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  createdAt: number;
  updatedAt: number;
  config: {
    mode: "sequential" | "fixloop" | "parallel" | "adaptive";
    maxFixIterations: number;
    qualityThreshold: number;
    timeoutMinutes: number;
    agents: {
      planner:   { maxTurns: number; enabled: boolean };
      developer: { maxTurns: number; enabled: boolean };
      tester:    { maxTurns: number; enabled: boolean };
      reviewer:  { maxTurns: number; enabled: boolean };
    };
  };
}

// ─── Multi-user collaboration ──────────────────────────────────────────

export interface RunPermission {
  userId: string;
  role: UserRole;
  canAddTask: boolean;
  canApproveTask: boolean;
  canEditQueue: boolean;
  canStartStop: boolean;
  canManageShare: boolean;
}

export interface ClientSession {
  sessionId: string;
  userId: string;
  displayName: string;
  role: UserRole;
  connectedAt: number;
  lastActiveAt: number;
  currentPage?: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  runId: string;
  userId: string;
  displayName: string;
  content: string;
  createdAt: number;
  updatedAt?: number;
}

export function hasPermission(perm: RunPermission | undefined, action: "addTask" | "approveTask" | "editQueue" | "startStop" | "manageShare"): boolean {
  if (!perm) return false;
  switch (action) {
    case "addTask": return perm.canAddTask;
    case "approveTask": return perm.canApproveTask;
    case "editQueue": return perm.canEditQueue;
    case "startStop": return perm.canStartStop;
    case "manageShare": return perm.canManageShare;
  }
}

export function roleToPermissions(role: UserRole): Omit<RunPermission, "userId"> {
  switch (role) {
    case "owner":
      return { role: "owner", canAddTask: true, canApproveTask: true, canEditQueue: true, canStartStop: true, canManageShare: true };
    case "collaborator":
      return { role: "collaborator", canAddTask: true, canApproveTask: true, canEditQueue: true, canStartStop: false, canManageShare: false };
    case "viewer":
      return { role: "viewer", canAddTask: false, canApproveTask: false, canEditQueue: false, canStartStop: false, canManageShare: false };
  }
}
