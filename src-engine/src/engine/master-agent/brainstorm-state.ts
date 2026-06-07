/** Brainstorming phases for the master agent's task creation flow. */
export type BrainstormPhase =
  | "contextualizing" // Understanding project context, working directory, existing code
  | "exploring" // Asking clarifying questions about goals, constraints
  | "approaches" // Proposing 2-3 approaches with trade-offs
  | "designing" // Presenting structured task plan for approval
  | "approved" // User approved, ready to create tasks
  | "inactive"; // Not in brainstorming mode

/** Quick-path phases for streamlined task creation when user provides a project path. */
export type QuickPathPhase = "probing" | "refining" | "approved";

export interface ProjectInfo {
  name: string;
  type: string; // "node" | "python" | "go" | "rust" | "java" | "unknown"
  framework?: string;
  hasTests: boolean;
  hasDocker: boolean;
  hasCI: boolean;
  topFiles: string[];
  gitRemote?: string;
}

export interface BrainstormContext {
  workingDir?: string;
  problem?: string;
  goals?: string[];
  constraints?: string[];
  terminationConditions?: string[];
  subTasks?: SubTaskDraft[];
  projectInfo?: ProjectInfo;
}

export interface BrainstormState {
  phase: BrainstormPhase | QuickPathPhase;
  activatedAt: number;
  context?: BrainstormContext;
  quickPath?: boolean;
}

export interface SubTaskDraft {
  content: string;
  priority?: number;
  dependsOn?: string[];
}

export const PHASE_LABELS: Record<BrainstormPhase | QuickPathPhase, string> = {
  contextualizing: "理解上下文",
  exploring: "探索问题",
  approaches: "提出方案",
  designing: "设计任务计划",
  approved: "创建任务",
  inactive: "未激活",
  probing: "探测项目",
  refining: "细化目标",
};
