import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { EmptyState } from "../common/EmptyState";
import { StreamingOutput } from "./StreamingOutput";
import { LogSearchBar } from "./LogSearchBar";

interface LogEntry {
  id: number;
  timestamp: number;
  level: string;
  source: string;
  message: string;
}

function levelColor(level: string): string {
  switch (level) {
    case "error": return "var(--red)";
    case "warn": return "var(--yellow)";
    case "info": return "var(--blue)";
    default: return "var(--text-secondary)";
  }
}

const MAX_VISIBLE_LOGS = 200;

interface LogPanelProps {
  logs: LogEntry[];
  activeTaskIds: string[];
}

export function LogPanel({ logs, activeTaskIds }: LogPanelProps) {
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleFilteredLogsChange = useCallback((filtered: LogEntry[]) => setFilteredLogs(filtered), []);

  const displayLogs = filteredLogs.length > 0 ? filteredLogs : logs;

  const visibleLogs = useMemo(() => {
    return displayLogs.length > MAX_VISIBLE_LOGS
      ? displayLogs.slice(-MAX_VISIBLE_LOGS)
      : displayLogs;
  }, [displayLogs]);

  const hasMore = displayLogs.length > MAX_VISIBLE_LOGS;
  const skippedCount = displayLogs.length - visibleLogs.length;

  if (logs.length === 0 && activeTaskIds.length === 0) {
    return (
      <EmptyState
        title="等待任务执行"
        description="启动后日志将实时显示在这里"
        variant="logs"
      />
    );
  }

  return (
    <div className="space-y-0.5">
      <div className="mb-2">
        <LogSearchBar logs={logs} onFilteredChange={handleFilteredLogsChange} />
      </div>
      {activeTaskIds.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-blue-400 font-mono text-xs font-bold">实时输出</span>
          </div>
          <StreamingOutput taskId={activeTaskIds[0]} />
        </div>
      )}
      {hasMore && (
        <div className="text-xs py-1 px-2 rounded" style={{ color: "var(--text-secondary)", background: "var(--bg-secondary, rgba(255,255,255,0.05))" }}>
          显示最近 {visibleLogs.length} 条 (共 {displayLogs.length} 条，已省略 {skippedCount} 条早期日志)
        </div>
      )}
      {visibleLogs.map((log) => (
        <div
          key={log.id}
          className="terminal-line terminal-line-enter"
          style={{ contentVisibility: "auto", containIntrinsicSize: "auto 48px" }}
        >
          <span style={{ color: "var(--text-secondary)" }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>{" "}
          <span style={{ color: levelColor(log.level) }}>[{log.level.toUpperCase()}]</span>{" "}
          <span style={{ color: "var(--text-secondary)" }}>[{log.source}]</span>{" "}
          <span style={{ color: "var(--text-primary)" }}>{log.message}</span>
        </div>
      ))}
      <div ref={logsEndRef} />
    </div>
  );
}
