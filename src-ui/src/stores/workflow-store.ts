/**
 * Workflow Store — 前端 Zustand store
 *
 * 管理活跃 workflow 列表、阶段进度、路由决策。
 */

import { create } from "zustand";

// ─── 类型 ────────────────────────────────────────────────────────────────

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  isBuiltIn: boolean;
  useCase?: string;
}

export interface StageProgress {
  stageId: string;
  stageName: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  durationMs?: number;
  costUsd?: number;
}

export interface WorkflowProgress {
  executionId: string;
  definitionId: string;
  definitionName: string;
  status: "running" | "completed" | "failed" | "cancelled";
  stages: StageProgress[];
  currentStageIndex: number;
  totalAgents: number;
  completedAgents: number;
  totalCostUsd: number;
  totalDurationMs: number;
}

export interface RouterDecision {
  taskId?: string;
  taskSummary: string;
  strategy: { type: string; templateName?: string };
  level: string;
  reason: string;
  confidence: number;
  timestamp: number;
}

// ─── Store ───────────────────────────────────────────────────────────────

interface WorkflowState {
  /** 可用 workflow 模板列表 */
  templates: WorkflowSummary[];
  /** 当前活跃的 workflow 进度 */
  activeWorkflows: Map<string, WorkflowProgress>;
  /** 最近的 Task Router 决策 */
  routerDecisions: RouterDecision[];
  /** 是否正在加载 */
  loading: boolean;

  // ─── Actions ──────────────────────────────────────────────────────
  setTemplates: (templates: WorkflowSummary[]) => void;
  updateWorkflowProgress: (progress: Partial<WorkflowProgress> & { executionId: string }) => void;
  removeWorkflow: (executionId: string) => void;
  addRouterDecision: (decision: RouterDecision) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  templates: [],
  activeWorkflows: new Map(),
  routerDecisions: [],
  loading: false,

  setTemplates: (templates) => set({ templates }),

  updateWorkflowProgress: (progress) =>
    set((state) => {
      const updated = new Map(state.activeWorkflows);
      const existing = updated.get(progress.executionId);
      if (existing) {
        updated.set(progress.executionId, { ...existing, ...progress });
      } else {
        updated.set(progress.executionId, {
          executionId: progress.executionId,
          definitionId: progress.definitionId ?? "",
          definitionName: progress.definitionName ?? "",
          status: progress.status ?? "running",
          stages: progress.stages ?? [],
          currentStageIndex: progress.currentStageIndex ?? 0,
          totalAgents: progress.totalAgents ?? 0,
          completedAgents: progress.completedAgents ?? 0,
          totalCostUsd: progress.totalCostUsd ?? 0,
          totalDurationMs: progress.totalDurationMs ?? 0,
        });
      }
      return { activeWorkflows: updated };
    }),

  removeWorkflow: (executionId) =>
    set((state) => {
      const updated = new Map(state.activeWorkflows);
      updated.delete(executionId);
      return { activeWorkflows: updated };
    }),

  addRouterDecision: (decision) =>
    set((state) => ({
      routerDecisions: [decision, ...state.routerDecisions].slice(0, 20),
    })),

  setLoading: (loading) => set({ loading }),

  reset: () =>
    set({
      templates: [],
      activeWorkflows: new Map(),
      routerDecisions: [],
      loading: false,
    }),
}));
