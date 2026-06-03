import { RobotMascot } from "../dashboard/RobotMascot";
import { ENGINE_HTTP_URL } from "../../lib/platform";

interface RunHeaderProps {
  runId: string | undefined;
  run: import("@ai-workbench/shared").ExecutionRun | null | undefined;
  elapsed: string;
  isRunning: boolean;
  onBack: () => void;
  onShare?: () => void;
  onShowQueue: () => void;
  onShowPanel: () => void;
  hideDownload?: boolean;
  shareMode?: boolean;
  wsConnected?: boolean;
}

export function RunHeader({
  runId,
  run,
  elapsed,
  isRunning,
  onBack,
  onShare,
  onShowQueue,
  onShowPanel,
  hideDownload,
  shareMode,
  wsConnected,
}: RunHeaderProps) {
  return (
    <div
      className="px-6 py-3 border-b flex items-center justify-between max-md:px-3"
      style={{ borderColor: "var(--border)", animation: "slideDown 0.3s ease-out" }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {!shareMode && <button
          onClick={onBack}
          className="text-xs px-2 py-1 rounded hover:opacity-80 shrink-0"
          style={{ color: "var(--text-secondary)" }}
          aria-label="返回"
        >
          &larr;
        </button>}
        <h2 className="text-sm font-bold truncate">任务详情</h2>
        <span className="text-xs hidden md:inline" style={{ color: "var(--text-secondary)" }}>
          {runId?.substring(0, 8)}
        </span>
        {run && !shareMode && (
          <span
            className="text-xs px-2 py-0.5 rounded hidden md:inline"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
          >
            {run.workingDir.split("/").pop()}
          </span>
        )}
        <span className="text-xs hidden md:inline" style={{ color: "var(--text-secondary)" }}>
          {elapsed}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {/* Download ZIP button */}
        {!hideDownload && (
          <button
            onClick={() => window.open(`${ENGINE_HTTP_URL}/api/runs/${runId}/download`)}
            className="text-xs px-3 py-1.5 rounded font-semibold hidden md:inline"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
            title="下载工作目录 ZIP"
          >
            下载
          </button>
        )}
        {/* Share button */}
        {onShare && (
          <button
            onClick={onShare}
            className="text-xs px-3 py-1.5 rounded font-semibold hidden md:inline"
            style={{ background: "var(--blue)", color: "#fff" }}
          >
            分享
          </button>
        )}
        {/* Connection indicator in share mode */}
        {shareMode && wsConnected !== undefined && (
          <span className="text-[10px] px-1.5 py-0.5 rounded hidden md:inline" style={{
            background: wsConnected ? "rgba(16, 185, 129, 0.1)" : "rgba(245, 158, 11, 0.1)",
            color: wsConnected ? "var(--green)" : "var(--yellow)",
          }}>
            {wsConnected ? "实时" : "轮询中"}
          </span>
        )}
        {/* Mobile drawer toggles */}
        <button
          onClick={onShowQueue}
          className="md:hidden text-xs px-2 py-1 rounded"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
          aria-label="打开任务队列"
        >
          &#9776; 待办
        </button>
        <button
          onClick={onShowPanel}
          className="md:hidden text-xs px-2 py-1 rounded"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
          aria-label="打开操作"
        >
          &#9881; 操作
        </button>
        <RobotMascot
          mood={isRunning ? "working" : run?.status === "completed" ? "celebrating" : "idle"}
          size={32}
        />
        <span
          className="status-badge hidden md:inline"
          style={{
            background: isRunning
              ? "rgba(77, 107, 254, 0.15)"
              : run?.status === "completed"
                ? "rgba(16, 185, 129, 0.15)"
                : "rgba(125, 133, 144, 0.15)",
            color: isRunning
              ? "var(--blue)"
              : run?.status === "completed"
                ? "var(--green)"
                : "var(--text-secondary)",
          }}
        >
          {isRunning ? "工作中" : run?.status === "completed" ? "已完成" : run?.status === "failed" ? "出错了" : "准备中"}
        </span>
      </div>
    </div>
  );
}
