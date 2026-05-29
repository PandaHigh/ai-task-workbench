import type { TaskStatus, RunStatus, TaskType, LessonCategory, GoalStatus, CheckpointType, ApprovalStatus, ExecutionMode, AgentRoleType, UserRole } from "./enums.js";
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
    goalStatus?: GoalStatus;
    goalBudgetTokens?: number;
    goalTokensUsed?: number;
    goalTimeStartedAt?: number;
    goalTimeElapsedMs?: number;
    goalEvaluationCycles?: number;
    goalLastEvalReason?: string;
    goalEvidence?: string[];
    approvalTimeoutMs?: number;
    executionMode?: ExecutionMode;
    maxConcurrentAgents?: number;
    agentRoles?: AgentRole[];
    features?: FeatureItem[];
    featuresGeneratedAt?: number;
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
export interface GoalEvaluationResult {
    achieved: boolean;
    reason: string;
    evidence: string[];
    progress: number;
    nextSteps: string;
}
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
export interface AgentRole {
    id: string;
    type: AgentRoleType;
    name: string;
    systemPrompt: string;
    allowedTools: string[];
}
export interface FeatureItem {
    id: string;
    category: "functional" | "non_functional" | "edge_case";
    description: string;
    steps: string[];
    passes: boolean;
    priority: number;
    verifiedAt?: number;
    verifiedBy?: string;
}
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
export interface ActivityEvent {
    id: string;
    timestamp: number;
    userId: string;
    action: string;
    details: Record<string, unknown>;
    runId: string;
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
export declare function hasPermission(perm: RunPermission | undefined, action: "addTask" | "approveTask" | "editQueue" | "startStop" | "manageShare"): boolean;
export declare function roleToPermissions(role: UserRole): Omit<RunPermission, "userId">;
//# sourceMappingURL=task-types.d.ts.map