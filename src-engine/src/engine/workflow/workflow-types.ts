/**
 * Workflow Runtime — 类型定义
 *
 * 所有复杂任务统一走 WorkflowRuntime 执行引擎。
 * OMX Pipeline、安全审计等都是内置的 WorkflowDefinition 模板。
 */

// ─── 阶段类型 ────────────────────────────────────────────────────────────

export type WorkflowStageType =
  | "agent"        // 单 Agent 执行
  | "parallel"     // 子阶段并行
  | "sequence"     // 子阶段顺序
  | "loop"         // 条件循环
  | "condition"    // 条件分支
  | "adversarial"; // 对抗性验证

// ─── 阶段定义 ────────────────────────────────────────────────────────────

/** 基础阶段属性 */
interface BaseStage {
  id: string;
  name: string;
  description?: string;
  /** 阶段间质量门控阈值 0-1，低于此值则失败 */
  gateThreshold?: number;
  /** 最大超时（毫秒） */
  timeoutMs?: number;
  /** 失败后重试次数 */
  maxRetries?: number;
}

/** 单 Agent 阶段 */
export interface AgentStage extends BaseStage {
  type: "agent";
  /** OMX 角色ID（如 "planner", "executor", "momus"） */
  role: string;
  /** Agent 的任务提示词 */
  prompt: string;
  /** 是否根据任务内容动态选择角色 */
  roleRouter?: boolean;
  /** 允许的工具列表，不指定则使用角色默认 */
  allowedTools?: string[];
  /** 最大轮次 */
  maxTurns?: number;
}

/** 并行阶段：子阶段并发执行 */
export interface ParallelStage extends BaseStage {
  type: "parallel";
  stages: WorkflowStage[];
  /** 最大并发数 */
  maxConcurrency?: number;
}

/** 顺序阶段：子阶段按序执行 */
export interface SequenceStage extends BaseStage {
  type: "sequence";
  stages: WorkflowStage[];
  /** 审查失败时回退到哪个阶段（ID） */
  loopBackTo?: string;
  /** 最大审查循环次数 */
  maxReviewLoops?: number;
}

/** 条件循环阶段 */
export interface LoopStage extends BaseStage {
  type: "loop";
  /** 循环体（要重复的阶段） */
  body: WorkflowStage[];
  /** 最大迭代次数 */
  maxIterations: number;
  /** 共识模式：所有 reviewer 都通过才退出 */
  consensus?: boolean;
}

/** 条件分支阶段 */
export interface ConditionStage extends BaseStage {
  type: "condition";
  /** 条件表达式（引用 context 变量） */
  expression: string;
  /** 条件为真时执行 */
  thenStage: WorkflowStage;
  /** 条件为假时执行 */
  elseStage?: WorkflowStage;
}

/** 对抗性验证阶段 */
export interface AdversarialStage extends BaseStage {
  type: "adversarial";
  /** 投票人数（奇数） */
  voterCount: number;
  /** 通过阈值（如 0.6 = 60% voter 无法反驳即通过） */
  passThreshold: number;
  /** 引导 voter 尝试反驳的提示词 */
  voterPrompt: string;
  /** 被验证的上游阶段 ID（默认为前一个阶段的输出） */
  targetStageId?: string;
}

export type WorkflowStage =
  | AgentStage
  | ParallelStage
  | SequenceStage
  | LoopStage
  | ConditionStage
  | AdversarialStage;

// ─── Workflow 定义 ───────────────────────────────────────────────────────

export interface WorkflowDefinition {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 阶段列表 */
  stages: WorkflowStage[];
  /** 创建时间 */
  createdAt: number;
  /** 是否内置 */
  isBuiltIn: boolean;
  /** 标签（用于 Task Router 匹配） */
  tags?: string[];
  /** 适用场景描述（帮助 AI 选择模板） */
  useCase?: string;
}

// ─── 执行状态 ────────────────────────────────────────────────────────────

export type StageStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface StageExecution {
  stageId: string;
  stageName: string;
  status: StageStatus;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  costUsd?: number;
  agentCount?: number;
  output?: string;
  error?: string;
  /** 对抗性投票结果 */
  votes?: Array<{ voterId: string; passed: boolean; reason: string }>;
}

export type WorkflowStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface WorkflowExecution {
  /** 执行 ID */
  id: string;
  /** Workflow 定义 ID */
  definitionId: string;
  /** 关联的 run ID */
  runId: string;
  /** 关联的 task ID */
  taskId?: string;
  /** 当前状态 */
  status: WorkflowStatus;
  /** 阶段执行记录 */
  stages: StageExecution[];
  /** 当前阶段的索引 */
  currentStageIndex: number;
  /** 总 agent 数 */
  totalAgents: number;
  /** 已完成 agent 数 */
  completedAgents: number;
  /** 总 token 成本 */
  totalCostUsd: number;
  /** 总耗时 */
  totalDurationMs: number;
  /** 创建时间 */
  createdAt: number;
  /** 完成时间 */
  completedAt?: number;
  /** 最终输出 */
  finalOutput?: string;
  /** 错误信息 */
  error?: string;
}

// ─── Workflow 上下文 ─────────────────────────────────────────────────────

export interface WorkflowContext {
  /** 工作目录 */
  workingDir: string;
  /** run 目标 */
  goals: string[];
  /** 任务内容 */
  taskContent: string;
  /** 前序阶段的输出，按 stageId 索引 */
  stageOutputs: Map<string, StageOutput>;
  /** 上一个阶段的输出（便捷访问） */
  lastOutput: StageOutput | null;
  /** token 预算剩余（美元） */
  budgetRemaining: number;
  /** 已使用的 token 预算 */
  budgetUsed: number;
}

export interface StageOutput {
  stageId: string;
  text: string;
  /** 结构化数据（如审查结果、评分等） */
  data?: Record<string, unknown>;
  /** 产出的文件列表 */
  files?: string[];
  /** 耗时 */
  durationMs: number;
  /** 成本 */
  costUsd: number;
}

// ─── Workflow 结果 ───────────────────────────────────────────────────────

export interface WorkflowResult {
  /** 最终输出文本 */
  finalOutput: string;
  /** 所有阶段输出 */
  stageOutputs: Map<string, StageOutput>;
  /** 总耗时 */
  totalDurationMs: number;
  /** 总成本 */
  totalCostUsd: number;
  /** 使用的 agent 总数 */
  totalAgents: number;
  /** 审查结果（如有） */
  reviewResult?: {
    approved: boolean;
    score: number;
    summary: string;
    issues?: Array<{ severity: string; description: string }>;
  };
  /** 是否通过了所有质量门控 */
  allGatesPassed: boolean;
}
