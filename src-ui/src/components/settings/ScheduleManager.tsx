import { useState, useEffect, useCallback } from "react";
import { useEngine } from "../../hooks/useEngine";
import { useToast } from "../common/Toast";

interface ScheduledJob {
  id: string;
  name: string;
  cronExpr: string;
  goals: string[];
  workingDir: string;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
}

export function ScheduleManager() {
  const { call } = useEngine();
  const toast = useToast();
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formCron, setFormCron] = useState("0 9 * * *");
  const [formGoals, setFormGoals] = useState("");
  const [formDir, setFormDir] = useState("");

  const loadJobs = useCallback(async () => {
    try {
      const list = await call("schedule.list", {}) as ScheduledJob[];
      setJobs(list ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [call]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const handleCreate = async () => {
    if (!formName.trim() || !formGoals.trim() || !formCron.trim()) return;
    try {
      await call("schedule.create", {
        name: formName.trim(),
        cronExpr: formCron.trim(),
        goals: formGoals.trim().split("\n").filter((l) => l.trim()),
        workingDir: formDir.trim() || "/tmp",
      });
      setFormName(""); setFormCron("0 9 * * *"); setFormGoals(""); setFormDir("");
      setShowForm(false);
      loadJobs();
      toast.success("定时任务已创建");
    } catch (err) { toast.error(`创建失败: ${err instanceof Error ? err.message : err}`); }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await call("schedule.toggle", { id, enabled: !enabled });
      loadJobs();
      toast.success(!enabled ? "已启用" : "已暂停");
    } catch (err) { toast.error(`操作失败: ${err instanceof Error ? err.message : err}`); }
  };

  const handleDelete = async (id: string) => {
    try {
      await call("schedule.delete", { id });
      loadJobs();
      toast.success("已删除");
    } catch (err) { toast.error(`删除失败: ${err instanceof Error ? err.message : err}`); }
  };

  if (loading) return <p className="text-xs" style={{ color: "var(--text-secondary)" }}>加载中...</p>;

  return (
    <div className="space-y-3">
      {jobs.length === 0 && !showForm && (
        <p className="text-xs text-center py-2" style={{ color: "var(--text-secondary)" }}>暂无定时任务</p>
      )}

      {jobs.map((job) => (
        <div key={job.id} className="px-3 py-2.5 rounded-lg text-xs" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>{job.name}</span>
                <span
                  className="px-1.5 py-0.5 rounded text-[10px]"
                  style={{
                    background: job.enabled ? "rgba(16, 185, 129, 0.15)" : "rgba(125,133,144,0.15)",
                    color: job.enabled ? "var(--green)" : "var(--text-secondary)",
                  }}
                >
                  {job.enabled ? "运行中" : "已暂停"}
                </span>
              </div>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {job.cronExpr} &middot; {job.goals.length} 个目标
              </p>
              {job.lastRunAt && (
                <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                  上次运行: {new Date(job.lastRunAt).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => handleToggle(job.id, job.enabled)}
                className="px-2 py-1 rounded text-[10px]"
                style={{ background: job.enabled ? "var(--yellow)" : "var(--green)", color: "#fff" }}>
                {job.enabled ? "暂停" : "启用"}
              </button>
              <button onClick={() => handleDelete(job.id)}
                className="px-2 py-1 rounded text-[10px]"
                style={{ background: "var(--red)", color: "#fff" }}>删除</button>
            </div>
          </div>
        </div>
      ))}

      {showForm ? (
        <div className="p-3 rounded-lg space-y-2" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
          <h4 className="text-[10px] font-bold" style={{ color: "var(--text-secondary)" }}>创建定时任务</h4>
          <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="任务名称"
            className="w-full px-2 py-1.5 rounded text-xs outline-none"
            style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
          <input value={formCron} onChange={(e) => setFormCron(e.target.value)} placeholder="Cron 表达式 (如: 0 9 * * *)"
            className="w-full px-2 py-1.5 rounded text-xs outline-none"
            style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
          <textarea value={formGoals} onChange={(e) => setFormGoals(e.target.value)} placeholder="目标（每行一个）" rows={3}
            className="w-full px-2 py-1.5 rounded text-xs outline-none resize-none"
            style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
          <input value={formDir} onChange={(e) => setFormDir(e.target.value)} placeholder="工作目录 (默认 /tmp)"
            className="w-full px-2 py-1.5 rounded text-xs outline-none"
            style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-2 py-1 rounded text-[10px]"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>取消</button>
            <button onClick={handleCreate} disabled={!formName.trim() || !formGoals.trim()} className="px-2 py-1 rounded text-[10px] font-semibold disabled:opacity-40"
              style={{ background: "var(--green)", color: "#fff" }}>创建</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} className="w-full px-3 py-2 rounded text-xs font-semibold"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px dashed var(--border)" }}>
          + 添加定时任务
        </button>
      )}
    </div>
  );
}
