/**
 * WorkflowProgress — 聊天气泡内的紧凑进度条
 *
 * 嵌入在 ChatMessage 中显示 workflow 执行进度。
 */

import React from "react";

interface Stage {
  stageId: string;
  stageName: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
}

interface WorkflowProgressProps {
  definitionName: string;
  stages: Stage[];
  currentStageIndex: number;
  totalAgents: number;
  completedAgents: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-200 dark:bg-gray-700",
  running: "bg-blue-400 animate-pulse",
  passed: "bg-green-400",
  failed: "bg-red-400",
  skipped: "bg-gray-300 dark:bg-gray-600",
};

export const WorkflowProgress: React.FC<WorkflowProgressProps> = ({
  definitionName,
  stages,
  totalAgents,
  completedAgents,
}) => {
  return (
    <div className="my-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">🔄 {definitionName}</span>
        <span className="text-xs text-gray-400">
          {completedAgents}/{totalAgents} agents
        </span>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1 mb-2">
        {stages.map((stage) => (
          <div
            key={stage.stageId}
            className={`h-1.5 flex-1 rounded-full ${STATUS_COLORS[stage.status]}`}
            title={`${stage.stageName}: ${stage.status}`}
          />
        ))}
      </div>

      {/* Stage labels */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {stages.map((stage) => {
          const icons: Record<string, string> = {
            pending: "○",
            running: "◉",
            passed: "●",
            failed: "✕",
            skipped: "—",
          };
          const colors: Record<string, string> = {
            pending: "text-gray-400",
            running: "text-blue-500",
            passed: "text-green-500",
            failed: "text-red-500",
            skipped: "text-gray-400",
          };
          return (
            <span key={stage.stageId} className={`text-xs ${colors[stage.status]}`}>
              {icons[stage.status]} {stage.stageName}
            </span>
          );
        })}
      </div>
    </div>
  );
};
