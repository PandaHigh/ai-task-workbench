import { useState } from "react";
import type { TraceSpan } from "@ai-workbench/shared";
import { formatDuration } from "../../lib/utils";

interface TraceTimelineProps {
  spans: TraceSpan[];
}

const ROLE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  planner: { bg: "rgba(77, 107, 254, 0.15)", border: "var(--blue)", text: "var(--blue)" },
  developer: { bg: "rgba(16, 185, 129, 0.15)", border: "var(--green)", text: "var(--green)" },
  tester: { bg: "rgba(234, 179, 8, 0.15)", border: "var(--yellow)", text: "var(--yellow)" },
  reviewer: { bg: "rgba(139, 92, 246, 0.15)", border: "#8b5cf6", text: "#8b5cf6" },
};

const STATUS_COLORS: Record<string, string> = {
  ok: "var(--green)",
  error: "var(--red)",
  running: "var(--blue)",
};

const DEFAULT_COLOR = { bg: "var(--bg-tertiary)", border: "var(--border)", text: "var(--text-secondary)" };

function getRoleFromOperation(operation: string): string {
  if (operation.includes("planner")) return "planner";
  if (operation.includes("developer")) return "developer";
  if (operation.includes("tester")) return "tester";
  if (operation.includes("reviewer")) return "reviewer";
  return "";
}

export function TraceTimeline({ spans }: TraceTimelineProps) {
  const [expandedSpan, setExpandedSpan] = useState<string | null>(null);

  if (spans.length === 0) {
    return (
      <div className="font-mono text-xs py-4 text-center" style={{ color: "var(--text-muted)" }}>
        No trace data available
      </div>
    );
  }

  const sorted = [...spans].sort((a, b) => a.startTime - b.startTime);
  const firstStart = sorted[0].startTime;
  const lastEnd = Math.max(...sorted.map((s) => s.endTime ?? Date.now()));
  const totalRange = lastEnd - firstStart || 1;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
          Trace Timeline ({spans.length} spans)
        </span>
      </div>
      <div
        className="relative"
        style={{
          minHeight: sorted.length * 40 + 16,
          background: "var(--bg-primary)",
          borderRadius: "8px",
          padding: "8px",
        }}
      >
        {sorted.map((span) => {
          const role = getRoleFromOperation(span.operation);
          const colors = ROLE_COLORS[role] ?? DEFAULT_COLOR;
          const leftPct = ((span.startTime - firstStart) / totalRange) * 100;
          const widthPct = Math.max(
            2,
            ((span.endTime ?? Date.now()) - span.startTime) / totalRange * 100
          );
          const isExpanded = expandedSpan === span.spanId;
          const isRunning = span.status === "running";

          return (
            <div key={span.spanId} className="relative" style={{ height: "36px", marginBottom: "4px" }}>
              <div
                onClick={() => setExpandedSpan(isExpanded ? null : span.spanId)}
                className="absolute top-0 h-[32px] rounded flex items-center px-2 cursor-pointer overflow-hidden"
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  minWidth: "60px",
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  animation: isRunning ? "pulse 2s ease-in-out infinite" : undefined,
                  transition: "opacity 0.15s",
                }}
              >
                <span className="text-[10px] font-bold truncate shrink-0" style={{ color: colors.text }}>
                  {span.operation}
                </span>
                {span.durationMs != null && (
                  <span className="text-[10px] ml-auto shrink-0 pl-1" style={{ color: "var(--text-secondary)" }}>
                    {formatDuration(span.durationMs)}
                  </span>
                )}
                {isRunning && (
                  <span className="text-[10px] ml-1 shrink-0 animate-pulse" style={{ color: STATUS_COLORS.running }}>
                    ...
                  </span>
                )}
                {!isRunning && (
                  <span
                    className="text-[10px] ml-1 shrink-0"
                    style={{ color: STATUS_COLORS[span.status] ?? "var(--text-secondary)" }}
                  >
                    {span.status === "ok" ? "OK" : "ERR"}
                  </span>
                )}
              </div>
              {isExpanded && (
                <div
                  className="absolute left-0 right-0 rounded p-3 text-xs z-10"
                  style={{
                    top: "36px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                  }}
                >
                  <div className="space-y-1">
                    <div className="flex gap-4">
                      <span style={{ color: "var(--text-secondary)" }}>Span:</span>
                      <span className="font-mono text-[10px]" style={{ color: "var(--text-primary)" }}>{span.spanId.substring(0, 8)}</span>
                    </div>
                    <div className="flex gap-4">
                      <span style={{ color: "var(--text-secondary)" }}>Operation:</span>
                      <span style={{ color: colors.text }}>{span.operation}</span>
                    </div>
                    <div className="flex gap-4">
                      <span style={{ color: "var(--text-secondary)" }}>Status:</span>
                      <span style={{ color: STATUS_COLORS[span.status] }}>{span.status}</span>
                    </div>
                    {span.durationMs != null && (
                      <div className="flex gap-4">
                        <span style={{ color: "var(--text-secondary)" }}>Duration:</span>
                        <span style={{ color: "var(--text-primary)" }}>{formatDuration(span.durationMs)}</span>
                      </div>
                    )}
                    <div className="flex gap-4">
                      <span style={{ color: "var(--text-secondary)" }}>Start:</span>
                      <span style={{ color: "var(--text-primary)" }}>{new Date(span.startTime).toLocaleTimeString()}</span>
                    </div>
                    {span.endTime && (
                      <div className="flex gap-4">
                        <span style={{ color: "var(--text-secondary)" }}>End:</span>
                        <span style={{ color: "var(--text-primary)" }}>{new Date(span.endTime).toLocaleTimeString()}</span>
                      </div>
                    )}
                    {Object.keys(span.attributes).length > 0 && (
                      <div>
                        <span style={{ color: "var(--text-secondary)" }}>Attributes:</span>
                        <pre className="mt-1 p-2 rounded text-[10px] overflow-x-auto" style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)" }}>
                          {JSON.stringify(span.attributes, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
