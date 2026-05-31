import { useEvolutionStore } from "../../stores/evolution-store";

const ROLE_LABELS: Record<string, string> = {
  planner: "规划师",
  developer: "开发者",
  tester: "测试员",
  reviewer: "审查员",
};

const ROLE_COLORS: Record<string, string> = {
  planner: "var(--blue)",
  developer: "var(--green)",
  tester: "var(--yellow)",
  reviewer: "var(--purple, #8b5cf6)",
};

export function AgentProgressPanel() {
  const agentProgress = useEvolutionStore((s) => s.agentProgress) ?? {};
  const entries = Object.entries(agentProgress);
  if (entries.length === 0) return null;

  return (
    <div className="mb-3 p-2 rounded" style={{ background: "var(--bg-tertiary)" }}>
      <div className="text-[10px] font-bold mb-1.5" style={{ color: "var(--text-secondary)" }}>
        Agent 进度
      </div>
      <div className="space-y-1.5">
        {entries.map(([role, progress]) => {
          const color = ROLE_COLORS[role] ?? "var(--text-secondary)";
          const label = ROLE_LABELS[role] ?? role;
          return (
            <div key={role}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-bold" style={{ color }}>
                  {label}
                </span>
                <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                  {progress.phase}
                </span>
              </div>
              <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "var(--bg-primary)" }}>
                <div
                  role="progressbar"
                  aria-valuenow={Math.round(progress.progress)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(2, progress.progress)}%`, background: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
