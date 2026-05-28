import { useState, useEffect } from "react";
import { useApprovalStore } from "../../stores/approval-store";
import { engineClient } from "../../lib/engine-client";
import type { CheckpointType } from "@ai-workbench/shared";

export function ApprovalPanel() {
  const pendingApprovals = useApprovalStore((s) => s.pendingApprovals);
  const removeApproval = useApprovalStore((s) => s.removeApproval);
  const [instructions, setInstructions] = useState("");
  const [timers, setTimers] = useState<Map<string, number>>(new Map());

  // Update countdown timers every second
  useEffect(() => {
    if (pendingApprovals.length === 0) return;
    const interval = setInterval(() => {
      setTimers((prev) => {
        const next = new Map(prev);
        for (const approval of pendingApprovals) {
          if (approval.timeoutMs) {
            const remaining = Math.max(0, approval.timeoutMs - (Date.now() - approval.createdAt));
            next.set(approval.id, remaining);
          }
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [pendingApprovals]);

  if (pendingApprovals.length === 0) return null;

  const approval = pendingApprovals[0];

  const respond = async (action: "approve" | "reject" | "modify") => {
    try {
      await engineClient.call("approval.respond", {
        runId: approval.runId,
        approvalId: approval.id,
        action,
        instructions: action === "modify" ? instructions : undefined,
      });
      removeApproval(approval.id);
      setInstructions("");
    } catch (err) {
      console.error("Failed to respond to approval:", err);
    }
  };

  const formatTimer = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const checkpointLabel: Record<CheckpointType, string> = {
    borderline_score: "评分接近阈值",
    risky_commit: "重大代码变更",
    goal_stagnation: "进度停滞",
  };

  const remaining = timers.get(approval.id);
  const contextData = approval.contextData ?? {};

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-amber-500/50 bg-[#1a1500]/95 backdrop-blur-sm"
         style={{ borderTopColor: "var(--color-amber-500, #f59e0b)" }}>
      <div className="max-w-4xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-amber-400 font-mono text-sm font-bold">
              {checkpointLabel[approval.checkpointType] ?? approval.checkpointType}
            </span>
            {remaining !== undefined && remaining > 0 && (
              <span className="text-amber-400/60 font-mono text-xs">
                {formatTimer(remaining)} 后自动通过
              </span>
            )}
          </div>
          {pendingApprovals.length > 1 && (
            <span className="text-amber-400/60 text-xs">
              +{pendingApprovals.length - 1} 个等待中
            </span>
          )}
        </div>

        <p className="text-amber-100/90 font-mono text-sm mb-3">{String(approval.summary)}</p>
        {approval.checkpointType === "borderline_score" && contextData.score ? (
          <div className="bg-black/30 rounded p-2 mb-3 font-mono text-xs">
            <div className="flex gap-4 text-gray-400">
              <span>评分: <span className="text-amber-300">{((contextData.score as Record<string, number>).overall * 100).toFixed(0)}%</span></span>
              <span>状态: <span className={((contextData.score as Record<string, boolean>).passed ? "text-green-400" : "text-red-400")}>
                {((contextData.score as Record<string, boolean>).passed ? "PASS" : "FAIL")}
              </span></span>
            </div>
            {Boolean((contextData.score as Record<string, string>).reasoning) ? (
              <p className="text-gray-500 mt-1">{(contextData.score as Record<string, string>).reasoning}</p>
            ) : null}
          </div>
        ) : null}

        {approval.checkpointType === "risky_commit" && contextData.diffStats ? (
          <div className="bg-black/30 rounded p-2 mb-3 font-mono text-xs">
            <div className="flex gap-4 text-gray-400">
              <span>变更文件: <span className="text-amber-300">{(contextData.diffStats as Record<string, number>).filesChanged}</span></span>
              <span>变更行数: <span className="text-amber-300">{(contextData.diffStats as Record<string, number>).linesChanged}</span></span>
              {(contextData.diffStats as Record<string, boolean>).hasCriticalFiles ? (
                <span className="text-red-400">涉及关键文件</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {approval.checkpointType === "goal_stagnation" && (
          <div className="bg-black/30 rounded p-2 mb-3 font-mono text-xs text-gray-400">
            <p>AI 已遇到瓶颈，需要你的方向性指导。可以选择：</p>
            <p className="mt-1 text-gray-500">继续执行 / 停止运行 / 注入新方向指令</p>
          </div>
        )}

        {/* Instructions input for modify */}
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="输入附加指令（可选）..."
            className="flex-1 bg-black/40 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-amber-500/50"
          />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => respond("approve")}
            className="px-4 py-1.5 bg-green-600/80 hover:bg-green-600 text-green-100 font-mono text-sm rounded transition-colors"
          >
            通过 (Y)
          </button>
          <button
            onClick={() => respond("reject")}
            className="px-4 py-1.5 bg-red-600/80 hover:bg-red-600 text-red-100 font-mono text-sm rounded transition-colors"
          >
            拒绝 (N)
          </button>
          {approval.checkpointType === "goal_stagnation" && (
            <button
              onClick={() => respond("modify")}
              className="px-4 py-1.5 bg-amber-600/80 hover:bg-amber-600 text-amber-100 font-mono text-sm rounded transition-colors"
            >
              重定向 (M)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
