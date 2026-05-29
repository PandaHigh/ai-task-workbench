import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
      toast.success("任务导入成功");
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
        style={{ animation: "slideUp 0.3s ease-out" }}
      >
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            我的任务
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
            {connected ? `AI 已就绪 · 共 ${tasks.length} 个任务` : "AI 未连接"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowImportModal(true)}
            className="text-xs"
            style={{ color: "var(--text-secondary)", background: "none", border: "none", textDecoration: "underline" }}
          >
            导入
          </button>
          <button
            onClick={() => navigate("/wizard")}
            className="px-3 py-1.5 rounded-md text-xs font-medium"
            style={{ background: "var(--blue)", color: "#fff", border: "none" }}
          >
            新建
          </button>
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} variant="card" height={120} />
          ))}
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <EmptyState
          title="欢迎使用 PandaAI"
          description="点击下方按钮，告诉我你想做什么"
          action={{ label: "开始第一个任务", onClick: () => navigate("/wizard") }}
          variant="default"
        />
      )}

      {!loading && tasks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {tasks.map((task, i) => (
            <div key={task.id} style={staggerItemStyle(i, 40)}>
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
            className="card p-6 w-full max-w-md"
            style={{ animation: "slideUp 0.2s ease-out" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>导入任务</h3>
            <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
              粘贴别人分享给你的链接
            </p>
            <input
              type="text"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleImport()}
              placeholder="粘贴分享链接..."
              className="w-full px-3 py-2 rounded-md text-xs outline-none mb-3"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-3 py-1.5 rounded-md text-xs"
                style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={importing || !importUrl.trim()}
                className="px-4 py-1.5 rounded-md text-xs font-medium disabled:opacity-50"
                style={{ background: "var(--blue)", color: "#fff" }}
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
