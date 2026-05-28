import { useMemo } from "react";
import type { FeatureItem } from "@ai-workbench/shared";

interface FeatureBoardProps {
  features: FeatureItem[];
}

const CATEGORY_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  functional: { color: "var(--blue)", bg: "rgba(59,130,246,0.15)", label: "功能" },
  non_functional: { color: "var(--yellow)", bg: "rgba(234,179,8,0.15)", label: "非功能" },
  edge_case: { color: "var(--purple)", bg: "rgba(168,85,247,0.15)", label: "边界" },
};

export function FeatureBoard({ features }: FeatureBoardProps) {
  const stats = useMemo(() => {
    const passed = features.filter((f) => f.passes).length;
    const byCategory: Record<string, { total: number; passed: number }> = {};
    for (const f of features) {
      if (!byCategory[f.category]) byCategory[f.category] = { total: 0, passed: 0 };
      byCategory[f.category].total++;
      if (f.passes) byCategory[f.category].passed++;
    }
    return { total: features.length, passed, byCategory, pct: features.length > 0 ? (passed / features.length) * 100 : 0 };
  }, [features]);

  if (features.length === 0) {
    return (
      <div className="text-gray-600 font-mono text-xs py-4 text-center">
        Feature list will be generated when execution starts
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex justify-between text-xs mb-1">
            <span style={{ color: "var(--text-secondary)" }}>
              {stats.passed}/{stats.total} features passed
            </span>
            <span style={{ color: stats.pct > 80 ? "var(--green)" : stats.pct > 50 ? "var(--yellow)" : "var(--text-secondary)" }}>
              {stats.pct.toFixed(0)}%
            </span>
          </div>
          <div className="w-full h-1.5 rounded" style={{ background: "var(--bg-tertiary)" }}>
            <div className="h-full rounded transition-all" style={{
              width: `${stats.pct}%`,
              background: stats.pct > 80 ? "var(--green)" : stats.pct > 50 ? "var(--yellow)" : "var(--blue)",
            }} />
          </div>
        </div>
      </div>

      {/* Category breakdown */}
      <div className="flex gap-2">
        {Object.entries(stats.byCategory).map(([cat, { total, passed }]) => {
          const style = CATEGORY_STYLES[cat] ?? { color: "var(--text-secondary)", bg: "var(--bg-tertiary)", label: cat };
          return (
            <div key={cat} className="flex-1 rounded p-2" style={{ background: style.bg }}>
              <div className="text-xs font-bold" style={{ color: style.color }}>{style.label}</div>
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{passed}/{total}</div>
            </div>
          );
        })}
      </div>

      {/* Feature list */}
      <div className="max-h-64 overflow-y-auto space-y-1">
        {features.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded text-xs"
            style={{ background: f.passes ? "rgba(63,185,80,0.08)" : "var(--bg-tertiary)" }}
          >
            <span className="shrink-0 w-4 text-center" style={{ color: f.passes ? "var(--green)" : "var(--text-secondary)" }}>
              {f.passes ? "✓" : "○"}
            </span>
            <span className="shrink-0 px-1 rounded text-[10px]" style={{
              background: CATEGORY_STYLES[f.category]?.bg ?? "var(--bg-primary)",
              color: CATEGORY_STYLES[f.category]?.color ?? "var(--text-secondary)",
            }}>
              {CATEGORY_STYLES[f.category]?.label ?? f.category}
            </span>
            <span className="shrink-0 text-[10px]" style={{ color: "var(--text-secondary)" }}>P{f.priority}</span>
            <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>{f.description}</span>
            {f.verifiedAt && (
              <span className="shrink-0 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                {new Date(f.verifiedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
