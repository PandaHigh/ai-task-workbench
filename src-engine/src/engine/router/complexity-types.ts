/**
 * Task Router — 类型定义
 *
 * 借鉴 Claude Code Ultracode 模式，根据任务复杂度动态选择执行策略：
 *   direct          → 简单任务，MasterAgent 直接工具调用完成
 *   builtin:xxx     → 中等/复杂任务，走内置 workflow 模板（如 omx-pipeline、security-audit）
 *   dynamic         → 大规模/特殊任务，AI 动态生成 workflow 脚本编排
 */

// ─── 复杂度等级 ──────────────────────────────────────────────────────────

export type ComplexityLevel = "simple" | "moderate" | "complex" | "massive";

// ─── 执行策略 ────────────────────────────────────────────────────────────

export type ExecutionStrategy = { type: "direct" } | { type: "builtin"; templateName: string } | { type: "dynamic" };

// ─── 复杂度评估结果 ──────────────────────────────────────────────────────

export interface ComplexityAssessment {
  /** 综合复杂度等级 */
  level: ComplexityLevel;
  /** 推荐执行策略 */
  strategy: ExecutionStrategy;
  /** AI 对路由决策的置信度 0-1 */
  confidence: number;
  /** 路由理由（可展示给用户） */
  reason: string;
  /** 评估维度得分 */
  dimensions: ComplexityDimensions;
  /** 预估需要的 agent 数量 */
  estimatedAgents: number;
  /** 预估 token 成本（美元） */
  estimatedCostUsd: number;
}

// ─── 复杂度评估维度 ──────────────────────────────────────────────────────

export interface ComplexityDimensions {
  /** 影响范围：涉及文件数/模块数（0-1，0=单文件，1=全代码库） */
  scope: number;
  /** 不确定性：是否需要先探索再规划（0-1，0=需求明确，1=高度不确定） */
  uncertainty: number;
  /** 风险等级：错误代价高低（0-1，0=低风险，1=生产关键） */
  risk: number;
  /** 并行机会：是否可以拆分为独立子任务（0-1，0=强依赖，1=完全独立） */
  parallelism: number;
  /** 验证需求：是否需要多角度交叉验证（0-1，0=简单验证，1=需对抗性审查） */
  verificationNeed: number;
}

// ─── 路由上下文 ──────────────────────────────────────────────────────────

export interface RoutingContext {
  /** 当前 runId */
  runId: string;
  /** 工作目录 */
  workingDir: string;
  /** 已完成的任务数 */
  completedTaskCount: number;
  /** 已使用的 token 预算（美元） */
  costUsedUsd: number;
  /** token 预算上限（美元） */
  costBudgetUsd: number;
  /** 运行开始时间 */
  startedAt?: number;
  /** 是否有明确目标 */
  hasGoals: boolean;
}

// ─── 路由决策通知 ────────────────────────────────────────────────────────

export interface RouterDecision {
  /** 任务 ID */
  taskId?: string;
  /** 任务内容摘要 */
  taskSummary: string;
  /** 路由决策 */
  strategy: ExecutionStrategy;
  /** 复杂度等级 */
  level: ComplexityLevel;
  /** 决策理由 */
  reason: string;
  /** 置信度 */
  confidence: number;
  /** 时间戳 */
  timestamp: number;
}
