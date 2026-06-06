import { useEvolutionStore } from "../../stores/evolution-store";

const ROLE_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  planner: { label: "规划师", icon: "📋", color: "var(--blue)", bg: "rgba(77,107,254,0.1)" },
  developer: { label: "开发者", icon: "💻", color: "var(--green)", bg: "rgba(16,185,129,0.1)" },
  tester: { label: "测试员", icon: "🧪", color: "var(--yellow)", bg: "rgba(234,179,8,0.1)" },
  reviewer: { label: "审查员", icon: "🔍", color: "var(--purple, #8b5cf6)", bg: "rgba(139,92,246,0.1)" },
};

export function AgentProgressPanel() {
  const agentProgress = useEvolutionStore((s) => s.agentProgress) ?? {};
  const entries = Object.entries(agentProgress);
  if (entries.length === 0) return null;

  return (
    <div>
      <div className="text-xs font-bold mb-2" style={{ color: "var(--text-secondary)" }}>
        Agent 进度
      </div>
      <div className="space-y-2">
        {entries.map(([role, progress]) => {
          const meta = ROLE_META[role] ?? {
            label: role,
            icon: "🤖",
            color: "var(--text-secondary)",
            bg: "var(--bg-tertiary)",
          };
          const pct = Math.round(progress.progress);
          return (
            <div
              key={role}
              className="rounded-lg px-3 py-2"
              style={{ background: meta.bg, border: `1px solid ${meta.color}22` }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm">{meta.icon}</span>
                <span className="text-xs font-semibold" style={{ color: meta.color }}>
                  {meta.label}
                </span>
                <span
                  className="text-[10px] ml-auto px-1.5 py-0.5 rounded-full"
                  style={{ background: `${meta.color}18`, color: meta.color }}
                >
                  {pct}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-primary)" }}>
                <div
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(3, progress.progress)}%`, background: meta.color }}
                />
              </div>
              {progress.phase && (
                <p className="text-[10px] mt-1.5 truncate" style={{ color: "var(--text-secondary)" }}>
                  {progress.phase}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
