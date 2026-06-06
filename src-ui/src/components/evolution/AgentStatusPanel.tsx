interface WorkerStatus {
  taskId: string;
  roleId: string;
  roleName: string;
  taskContent: string;
  startedAt: number;
}

const ROLE_COLORS: Record<string, string> = {
  developer: "var(--blue)",
  tester: "var(--green)",
  reviewer: "var(--yellow)",
};

interface AgentStatusPanelProps {
  workers: WorkerStatus[];
}

export function AgentStatusPanel({ workers }: AgentStatusPanelProps) {
  if (workers.length === 0) {
    return (
      <div className="text-xs font-mono py-2" style={{ color: "var(--text-secondary)" }}>
        无活跃 Worker
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {workers.map((w) => {
        const elapsed = Math.floor((Date.now() - w.startedAt) / 1000);
        const color = ROLE_COLORS[w.roleId] ?? "var(--text-secondary)";
        return (
          <div
            key={w.taskId}
            className="rounded p-2"
            style={{ background: "var(--bg-tertiary)", borderLeft: `2px solid ${color}` }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }} />
              <span className="text-xs font-bold" style={{ color }}>
                {w.roleName}
              </span>
              <span className="text-[10px] ml-auto" style={{ color: "var(--text-secondary)" }}>
                {elapsed > 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}
              </span>
            </div>
            <p className="text-xs truncate" style={{ color: "var(--text-primary)" }}>
              {w.taskContent}
            </p>
          </div>
        );
      })}
    </div>
  );
}
