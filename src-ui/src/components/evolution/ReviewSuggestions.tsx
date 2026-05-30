import { useState, useEffect } from "react";
import { useEngine } from "../../hooks/useEngine";
import { useEvolutionStore } from "../../stores/evolution-store";
import type { ReviewSuggestion } from "@ai-workbench/shared";

interface ReviewSuggestionsProps {
  runId: string;
}

export function ReviewSuggestions({ runId }: ReviewSuggestionsProps) {
  const { call } = useEngine();
  const storeSuggestions = useEvolutionStore((s) => s.suggestions);
  const setSuggestions = useEvolutionStore((s) => s.setSuggestions);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    call("suggestion.list", { runId })
      .then((data) => setSuggestions(data as ReviewSuggestion[]))
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
  }, [runId, call, setSuggestions]);

  if (loading) {
    return <div className="text-xs py-4 text-center" style={{ color: "var(--text-muted)" }}>加载中...</div>;
  }

  if (storeSuggestions.length === 0) {
    return <div className="text-xs py-4 text-center" style={{ color: "var(--text-muted)" }}>暂无审查建议</div>;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>
        审查建议 ({storeSuggestions.length})
      </div>
      {storeSuggestions.slice().reverse().map((suggestion) => (
        <div
          key={suggestion.id}
          className="p-3 rounded text-xs"
          style={{ background: "var(--bg-tertiary)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold" style={{ color: "var(--text-primary)" }}>
              后台审查
            </span>
            <div className="flex items-center gap-2">
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                style={{
                  background: suggestion.score >= 0.6 ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                  color: suggestion.score >= 0.6 ? "var(--green)" : "var(--red)",
                }}
              >
                {(suggestion.score * 100).toFixed(0)}%
              </span>
              {suggestion.status === "fix_created" && (
                <span className="text-[10px]" style={{ color: "var(--green)" }}>已创建修复</span>
              )}
            </div>
          </div>
          <p className="mb-2" style={{ color: "var(--text-secondary)" }}>{suggestion.summary}</p>
          {suggestion.issues.length > 0 && (
            <div className="space-y-1">
              {suggestion.issues.map((issue, idx) => (
                <div
                  key={idx}
                  className="p-1.5 rounded text-[11px]"
                  style={{
                    borderLeft: `2px solid ${issue.severity === "critical" ? "var(--red)" : issue.severity === "major" ? "var(--yellow)" : "var(--text-secondary)"}`,
                    background: "var(--bg-primary)",
                  }}
                >
                  <div className="flex items-center gap-1 mb-0.5">
                    <span style={{ color: issue.severity === "critical" ? "var(--red)" : "var(--yellow)" }}>
                      {issue.severity === "critical" ? "严重" : issue.severity === "major" ? "重要" : "轻微"}
                    </span>
                    {issue.file && (
                      <span className="font-mono" style={{ color: "var(--blue-light)" }}>
                        {issue.file}{issue.line ? `:${issue.line}` : ""}
                      </span>
                    )}
                  </div>
                  <div style={{ color: "var(--text-primary)" }}>{issue.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
