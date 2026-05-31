interface BudgetDisplayProps {
  budgetUsed: number;
  budgetMax: number;
  budgetPct: number;
  isRunning: boolean;
}

export function BudgetDisplay({ budgetUsed, budgetMax, budgetPct, isRunning }: BudgetDisplayProps) {
  if (!isRunning && budgetUsed <= 0) return null;

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span style={{ color: "var(--text-secondary)" }}>费用</span>
        <span style={{ color: budgetPct > 80 ? "var(--red)" : "var(--yellow)" }}>
          ${budgetUsed.toFixed(2)} / ${budgetMax}
        </span>
      </div>
      <div className="w-full h-1.5 rounded" style={{ background: "var(--bg-tertiary)" }}>
        <div
          role="progressbar"
          aria-valuenow={Math.round(budgetPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-full rounded transition-all"
          style={{
            width: `${budgetPct}%`,
            background: budgetPct > 80 ? "var(--red)" : budgetPct > 50 ? "var(--yellow)" : "var(--green)",
          }}
        />
      </div>
    </div>
  );
}
