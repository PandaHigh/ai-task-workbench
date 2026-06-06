import { useEffect, useState } from "react";
import { useTaskStore } from "../../stores/task-store";
import { useEngine } from "../../hooks/useEngine";
import { Skeleton } from "../common/Skeleton";
import { MasterChat } from "../chat/MasterChat";
import { TaskCard } from "./TaskCard";
import { pageEnterStyle, staggerItemStyle } from "../../hooks/useAnimations";

const REFRESH_INTERVAL = 30_000;

export function MainDashboard() {
  const { connected } = useEngine();
  const { tasks, loading, loadTasks } = useTaskStore();
  const [showTasks, setShowTasks] = useState(true);

  useEffect(() => {
    if (connected) loadTasks();
  }, [connected, loadTasks]);

  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => loadTasks(), REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [connected, loadTasks]);

  return (
    <div className="flex-1 flex overflow-hidden" style={pageEnterStyle()}>
      {/* AI 助手 — 主视图 */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <MasterChat />
      </div>

      {/* 任务列表 — 右侧可折叠面板 */}
      {showTasks && (
        <div
          className="flex-shrink-0 flex flex-col overflow-hidden border-l"
          style={{ width: 340, borderColor: "var(--border)" }}
        >
          {/* 面板头 */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
            style={{ borderColor: "var(--border)" }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
              我的任务 · {tasks.length}
            </span>
            <button
              onClick={() => setShowTasks(false)}
              style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 2 }}
              aria-label="收起任务面板"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="3" y1="3" x2="11" y2="11" />
                <line x1="11" y1="3" x2="3" y2="11" />
              </svg>
            </button>
          </div>

          {/* 任务列表 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} variant="card" height={80} />)}
            {!loading && tasks.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--text-tertiary)", textAlign: "center", padding: 24 }}>
                暂无任务，通过 AI 助手创建
              </p>
            )}
            {!loading && tasks.map((task, i) => (
              <div key={task.id} style={staggerItemStyle(i, 30)}>
                <TaskCard task={task} onDelete={() => loadTasks()} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 收起时的展开按钮 */}
      {!showTasks && (
        <button
          onClick={() => setShowTasks(true)}
          className="flex-shrink-0 flex items-center justify-center border-l"
          style={{
            width: 36,
            borderColor: "var(--border)",
            background: "var(--bg-secondary)",
            cursor: "pointer",
          }}
          aria-label="展开任务面板"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round">
            <rect x="1" y="1" width="12" height="12" rx="2" />
            <line x1="9.5" y1="1" x2="9.5" y2="13" />
          </svg>
        </button>
      )}
    </div>
  );
}
