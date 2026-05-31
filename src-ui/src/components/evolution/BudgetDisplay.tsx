interface BudgetDisplayProps {
  budgetUsed: number;
  budgetMax: number;
  budgetPct: number;
  isRunning: boolean;
}

export function BudgetDisplay({ budgetUsed, budgetMax, budgetPct, isRunning }: BudgetDisplayProps) {
  if (!isRunning && budgetUsed <= 0) return null;

  const isUnlimited = !isFinite(budgetMax);
  const displayMax = isUnlimited ? "∞" : `$${budgetMax}`;
  const displayPct = isUnlimited ? 0 : budgetPct;

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span style={{ color: "var(--text-secondary)" }}>费用</span>
        <span style={{ color: "var(--yellow)" }}>
          ${budgetUsed.toFixed(2)} / {displayMax}
        </span>
      </div>
      {!isUnlimited && (
        <div className="w-full h-1.5 rounded" style={{ background: "var(--bg-tertiary)" }}>
          <div
            role="progressbar"
            aria-valuenow={Math.round(displayPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-full rounded transition-all"
            style={{
              width: `${displayPct}%`,
              background: displayPct > 80 ? "var(--red)" : displayPct > 50 ? "var(--yellow)" : "var(--green)",
            }}
          />
        </div>
      )}
    </div>
  );
}
