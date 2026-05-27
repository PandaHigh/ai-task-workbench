import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RobotMascot } from "./RobotMascot";
import { TaskCard } from "./TaskCard";
import { useTaskStore } from "../../stores/task-store";
import { useEngine } from "../../hooks/useEngine";
import { Skeleton } from "../common/Skeleton";
import { EmptyState } from "../common/EmptyState";
import { useToast } from "../common/Toast";
import { pageEnterStyle, staggerItemStyle } from "../../hooks/useAnimations";

const REFRESH_INTERVAL = 30_000;

export function MainDashboard() {
  const navigate = useNavigate();
  const { connected, call } = useEngine();
  const { tasks, loading, loadTasks } = useTaskStore();
  const toast = useToast();
  const [showImportModal, setShowImportModal] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (connected) loadTasks();
  }, [connected, loadTasks]);

  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => loadTasks(), REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [connected, loadTasks]);

  const handleImport = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    try {
      await call("share.subscribe", { url: importUrl.trim() });
      toast.success("远程看板导入成功");
      setShowImportModal(false);
      setImportUrl("");
      loadTasks();
    } catch (err) {
      toast.error(`导入失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setImporting(false);
    }
  };

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
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowImportModal(true)}
            className="text-xs px-3 py-1.5 rounded font-semibold"
            style={{ background: "var(--blue)", color: "#0d1117" }}
          >
            + 导入分享
          </button>
          <RobotMascot mood={connected ? "idle" : "error"} />
        </div>
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

      {/* Import Modal */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setShowImportModal(false)}
        >
          <div
            className="glass-card p-6 w-full max-w-md"
            style={{ animation: "slideUp 0.3s ease-out" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold mb-3">导入分享看板</h3>
            <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
              粘贴分享链接以导入远程任务看板
            </p>
            <input
              type="text"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleImport()}
              placeholder="http://host:9731/api/share/token..."
              className="w-full px-3 py-2 rounded text-xs outline-none mb-3"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-3 py-1.5 rounded text-xs"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={importing || !importUrl.trim()}
                className="px-4 py-1.5 rounded text-xs font-semibold disabled:opacity-50"
                style={{ background: "var(--green)", color: "#0d1117" }}
              >
                {importing ? "导入中..." : "导入"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
