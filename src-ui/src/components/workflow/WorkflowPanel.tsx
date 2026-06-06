/**
 * WorkflowPanel — Workflow 进度可视化面板
 *
 * 在右侧面板中显示活跃 workflow 的阶段进度。
 * 每个阶段显示状态指示器、名称、耗时和成本。
 */

import React from "react";
import { useWorkflowStore } from "../../stores/workflow-store";

const STATUS_STYLES: Record<string, { icon: string; color: string }> = {
  pending: { icon: "⏳", color: "text-gray-400" },
  running: { icon: "🔄", color: "text-blue-400 animate-spin" },
  passed: { icon: "✅", color: "text-green-400" },
  failed: { icon: "❌", color: "text-red-400" },
  skipped: { icon: "⏭️", color: "text-gray-500" },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export const WorkflowPanel: React.FC = () => {
  const activeWorkflows = useWorkflowStore((s) => s.activeWorkflows);

  const workflows = Array.from(activeWorkflows.values());

  if (workflows.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        <div className="text-2xl mb-2">🔄</div>
        <p className="text-sm">暂无活跃的工作流</p>
        <p className="text-xs mt-1 text-gray-400">创建复杂任务时，系统会自动选择合适的工作流</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      {workflows.map((wf) => (
        <div key={wf.executionId} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{wf.definitionName}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  wf.status === "running"
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                    : wf.status === "completed"
                      ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                      : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                }`}
              >
                {wf.status === "running" ? "运行中" : wf.status === "completed" ? "已完成" : "失败"}
              </span>
            </div>
            <div className="flex gap-3 mt-1 text-xs text-gray-500">
              <span>
                🤖 {wf.completedAgents}/{wf.totalAgents} agents
              </span>
              <span>💰 {formatCost(wf.totalCostUsd)}</span>
              <span>⏱ {formatDuration(wf.totalDurationMs)}</span>
            </div>
          </div>

          {/* Stages */}
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {wf.stages.map((stage, i) => {
              const style = STATUS_STYLES[stage.status] ?? STATUS_STYLES.pending;
              const isActive = i === wf.currentStageIndex && wf.status === "running";
              return (
                <div
                  key={stage.stageId}
                  className={`flex items-center gap-2 px-3 py-2 text-sm ${
                    isActive ? "bg-blue-50 dark:bg-blue-900/20" : ""
                  }`}
                >
                  <span className={`text-base ${style.color}`}>{style.icon}</span>
                  <span
                    className={`flex-1 ${stage.status === "pending" ? "text-gray-400" : "text-gray-700 dark:text-gray-300"}`}
                  >
                    {stage.stageName}
                  </span>
                  {stage.durationMs ? (
                    <span className="text-xs text-gray-400">{formatDuration(stage.durationMs)}</span>
                  ) : null}
                  {stage.costUsd ? <span className="text-xs text-gray-400">{formatCost(stage.costUsd)}</span> : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
