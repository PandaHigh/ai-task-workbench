import { useNavigate } from "react-router-dom";
import { RobotMascot } from "./RobotMascot";
import { TaskCard } from "./TaskCard";
import { useTaskStore } from "../../stores/task-store";

export function MainDashboard() {
  const navigate = useNavigate();
  const tasks = useTaskStore((s) => s.tasks);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
            任务总览
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
            管理和监控所有 AI 任务
          </p>
        </div>
        <RobotMascot mood="idle" />
      </div>

      {tasks.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center py-20 rounded-lg border"
          style={{
            borderColor: "var(--border)",
            background: "var(--bg-secondary)",
          }}
        >
          <div className="text-4xl mb-4 animate-float">🤖</div>
          <p className="text-sm mb-2" style={{ color: "var(--text-secondary)" }}>
            还没有任务
          </p>
          <p className="text-xs mb-6" style={{ color: "var(--text-secondary)" }}>
            创建你的第一个 AI 任务开始使用
          </p>
          <button
            onClick={() => navigate("/wizard")}
            className="px-4 py-2 rounded text-xs font-semibold transition-colors"
            style={{
              background: "var(--green)",
              color: "#0d1117",
            }}
          >
            + 新建任务
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
