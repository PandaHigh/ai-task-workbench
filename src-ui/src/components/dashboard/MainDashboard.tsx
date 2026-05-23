import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { RobotMascot } from "./RobotMascot";
import { TaskCard } from "./TaskCard";
import { useTaskStore } from "../../stores/task-store";
import { useEngine } from "../../hooks/useEngine";
import { Skeleton } from "../common/Skeleton";
import { EmptyState } from "../common/EmptyState";
import { pageEnterStyle, staggerItemStyle } from "../../hooks/useAnimations";

const REFRESH_INTERVAL = 30_000;

export function MainDashboard() {
  const navigate = useNavigate();
  const { connected } = useEngine();
  const { tasks, loading, loadTasks } = useTaskStore();

  useEffect(() => {
    if (connected) loadTasks();
  }, [connected, loadTasks]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => loadTasks(), REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [connected, loadTasks]);

  return (
    <div className="flex-1 overflow-y-auto p-6" style={pageEnterStyle()}>
      <div
        className="flex items-center justify-between mb-6"
        style={{ animation: "slideUp 0.4s ease-out" }}
      >
        <div>
          <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            任务总览
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
            {connected ? `已连接引擎 · ${tasks.length} 个任务` : "引擎未连接"}
          </p>
        </div>
        <RobotMascot mood={connected ? "idle" : "error"} />
      </div>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} variant="card" height={120} />
          ))}
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <EmptyState
          title="还没有任务"
          description="创建你的第一个 AI 任务开始使用"
          action={{ label: "+ 新建任务", onClick: () => navigate("/wizard") }}
          variant="default"
        />
      )}

      {!loading && tasks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map((task, i) => (
            <div key={task.id} style={staggerItemStyle(i, 60)}>
              <TaskCard task={task} onDelete={() => loadTasks()} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
