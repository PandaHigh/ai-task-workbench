import { useState, type ReactNode } from "react";

const GOAL_STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  pursuing: { label: "追踪中", color: "var(--blue)", bg: "rgba(77, 107, 254,0.15)" },
  paused: { label: "已暂停", color: "var(--yellow)", bg: "rgba(234,179,8,0.15)" },
  achieved: { label: "已达成", color: "var(--green)", bg: "rgba(16, 185, 129,0.15)" },
  unmet: { label: "进行中", color: "var(--red)", bg: "rgba(239, 68, 68,0.15)" },
  budget_exhausted: { label: "预算已用完", color: "var(--red)", bg: "rgba(239, 68, 68,0.15)" },
};

function formatGoalDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

interface EditableListProps {
  title: string;
  items: string[];
  dotColor: string;
  onSave: (items: string[]) => Promise<unknown>;
}

export function EditableList({ title, items, dotColor, onSave }: EditableListProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  const startEdit = () => { setDraft([...items]); setEditing(true); };
  const addItem = () => setDraft([...draft, ""]);
  const removeItem = (i: number) => setDraft(draft.filter((_, idx) => idx !== i));
  const updateItem = (i: number, v: string) => { const d = [...draft]; d[i] = v; setDraft(d); };

  const save = async () => {
    const filtered = draft.map((s) => s.trim()).filter(Boolean);
    if (filtered.length === 0) return;
    await onSave(filtered);
    setEditing(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>{title}</h4>
        {!editing && (
          <button
            onClick={startEdit}
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ color: "var(--text-secondary)", background: "var(--bg-tertiary)", border: "none", cursor: "pointer" }}
          >
            编辑
          </button>
        )}
      </div>
      {!editing ? (
        items.map((g, i) => (
          <p key={i} className="text-xs mb-1 flex items-start gap-1">
            <span style={{ color: dotColor }}>&#8226;</span>
            <span style={{ color: "var(--text-primary)" }}>{g}</span>
          </p>
        ))
      ) : (
        <div className="space-y-1 mb-1">
          {draft.map((item, i) => (
            <div key={i} className="flex gap-1">
              <input
                value={item}
                onChange={(e) => updateItem(i, e.target.value)}
                className="flex-1 text-xs px-1.5 py-1 rounded font-mono"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)", outline: "none" }}
              />
              <button
                onClick={() => removeItem(i)}
                className="text-xs px-1"
                style={{ color: "var(--red)", background: "none", border: "none", cursor: "pointer" }}
              >
                &times;
              </button>
            </div>
          ))}
          <div className="flex gap-1 mt-1">
            <button
              onClick={addItem}
              className="text-[10px] px-2 py-0.5 rounded"
              style={{ color: dotColor, background: "var(--bg-tertiary)", border: "none", cursor: "pointer" }}
            >
              + 添加
            </button>
            <button
              onClick={save}
              className="text-[10px] px-2 py-0.5 rounded"
              style={{ color: "var(--green)", background: "var(--bg-tertiary)", border: "none", cursor: "pointer" }}
            >
              保存
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-[10px] px-2 py-0.5 rounded"
              style={{ color: "var(--text-secondary)", background: "var(--bg-tertiary)", border: "none", cursor: "pointer" }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface GoalPanelProps {
  run: import("@ai-workbench/shared").ExecutionRun;
  simpleMode: boolean;
  showAdvancedPanel: boolean;
  onToggleAdvanced: () => void;
  onSaveGoals: (items: string[]) => Promise<unknown>;
  onSaveTerminationConditions: (items: string[]) => Promise<unknown>;
  onClearGoal: (runId: string) => void;
  onPauseGoal: (runId: string) => void;
  onResumeGoal: (runId: string) => void;
  presenceSlot?: ReactNode;
}

export function GoalPanel({
  run,
  simpleMode,
  showAdvancedPanel,
  onToggleAdvanced,
  onSaveGoals,
  onSaveTerminationConditions,
  onClearGoal,
  onPauseGoal,
  onResumeGoal,
  presenceSlot,
}: GoalPanelProps) {
  return (
    <div>
      {/* Goals */}
      <EditableList
        title="目标"
        items={run.goals}
        dotColor="var(--green)"
        onSave={onSaveGoals}
      />

      {/* Termination Conditions */}
      <EditableList
        title="完成标准"
        items={run.terminationConditions}
        dotColor="var(--yellow)"
        onSave={onSaveTerminationConditions}
      />

      {/* Online Users - advanced only */}
      {!simpleMode && presenceSlot && (
        <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
          {presenceSlot}
        </div>
      )}

      {/* Advanced options toggle */}
      {simpleMode && (
        <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
          <button
            onClick={onToggleAdvanced}
            className="text-xs underline"
            style={{ color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer" }}
          >
            {showAdvancedPanel ? "收起高级选项" : "高级选项"}
          </button>
        </div>
      )}

      {/* Goal State Panel */}
      {run.goalStatus && run.goalStatus !== "unmet" && (
        <div className="border-t pt-3 space-y-2" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>进度</h4>
            <span
              className="text-xs px-1.5 py-0.5 rounded-full font-medium"
              style={{
                background: GOAL_STATUS_LABELS[run.goalStatus]?.bg ?? "var(--bg-secondary)",
                color: GOAL_STATUS_LABELS[run.goalStatus]?.color ?? "var(--text-secondary)",
              }}
            >
              {GOAL_STATUS_LABELS[run.goalStatus]?.label ?? run.goalStatus}
            </span>
          </div>

          {(run.goalEvaluationCycles ?? 0) > 0 && (
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span style={{ color: "var(--text-secondary)" }}>评估次数</span>
                <span>{run.goalEvaluationCycles}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "var(--text-secondary)" }}>用时</span>
                <span>{formatGoalDuration(run.goalTimeElapsedMs ?? 0)}</span>
              </div>
            </div>
          )}


          {run.goalLastEvalReason && (
            <div className="text-xs p-2 rounded" style={{ background: "var(--bg-primary)", color: "var(--text-secondary)" }}>
              {run.goalLastEvalReason}
            </div>
          )}

          {run.goalEvidence && run.goalEvidence.length > 0 && (
            <div className="max-h-32 overflow-y-auto space-y-1">
              {run.goalEvidence.slice(-8).map((e, i) => (
                <p key={i} className="text-xs flex items-start gap-1">
                  <span style={{ color: "var(--blue)" }}>&#8226;</span>
                  <span style={{ color: "var(--text-secondary)" }}>{e}</span>
                </p>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            {run.goalStatus === "pursuing" && (
              <>
                <button
                  className="text-xs px-2 py-1 rounded transition-colors"
                  style={{ background: "var(--bg-primary)", color: "var(--yellow)", border: "1px solid var(--border)" }}
                  onClick={() => onPauseGoal(run.id)}
                >
                  暂停
                </button>
                <button
                  className="text-xs px-2 py-1 rounded transition-colors"
                  style={{ background: "var(--bg-primary)", color: "var(--red)", border: "1px solid var(--border)" }}
                  onClick={() => onClearGoal(run.id)}
                >
                  清除
                </button>
              </>
            )}
            {run.goalStatus === "paused" && (
              <>
                <button
                  className="text-xs px-2 py-1 rounded transition-colors"
                  style={{ background: "var(--bg-primary)", color: "var(--green)", border: "1px solid var(--border)" }}
                  onClick={() => onResumeGoal(run.id)}
                >
                  恢复
                </button>
                <button
                  className="text-xs px-2 py-1 rounded transition-colors"
                  style={{ background: "var(--bg-primary)", color: "var(--red)", border: "1px solid var(--border)" }}
                  onClick={() => onClearGoal(run.id)}
                >
                  清除
                </button>
              </>
            )}
            {(run.goalStatus === "achieved" || run.goalStatus === "budget_exhausted") && (
              <span className="text-xs" style={{ color: run.goalStatus === "achieved" ? "var(--green)" : "var(--red)" }}>
                {run.goalStatus === "achieved" ? "已达成" : "预算已用完"}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}