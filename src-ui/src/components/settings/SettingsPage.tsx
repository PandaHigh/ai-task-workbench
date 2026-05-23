import { useEngine } from "../../hooks/useEngine";
import { useState, useEffect } from "react";
import { Skeleton } from "../common/Skeleton";
import { useToast } from "../common/Toast";
import { pageEnterStyle } from "../../hooks/useAnimations";

export function SettingsPage() {
  const { connected, call } = useEngine();
  const toast = useToast();
  const [qualityThreshold, setQualityThreshold] = useState(0.6);
  const [defaultTimeout, setDefaultTimeout] = useState(60);
  const [claudePath, setClaudePath] = useState("claude");
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!connected) return;
    const load = async () => {
      try {
        const qt = await call("config.get", { key: "qualityThreshold" });
        const val = (qt as Record<string, unknown> | null)?.value;
        if (val != null) setQualityThreshold(Number(val));
      } catch (err) {
        console.warn("Failed to load quality threshold:", err instanceof Error ? err.message : err);
        toast.error("加载质量阈值失败");
      }
      try {
        const dt = await call("config.get", { key: "defaultTimeout" });
        const val = (dt as Record<string, unknown> | null)?.value;
        if (val != null) setDefaultTimeout(Number(val));
      } catch (err) {
        console.warn("Failed to load default timeout:", err instanceof Error ? err.message : err);
        toast.error("加载超时设置失败");
      }
      try {
        const cp = await call("config.get", { key: "claudePath" });
        const val = (cp as Record<string, unknown> | null)?.value;
        if (val) setClaudePath(String(val));
      } catch (err) {
        console.warn("Failed to load claude path:", err instanceof Error ? err.message : err);
        toast.error("加载 Claude 路径失败");
      }
      setLoaded(true);
    };
    load();
  }, [connected]);

  const handleSave = async () => {
    try {
      await call("config.set", { key: "qualityThreshold", value: qualityThreshold });
      await call("config.set", { key: "defaultTimeout", value: defaultTimeout });
      await call("config.set", { key: "claudePath", value: claudePath });
      setSaved(true);
      toast.success("设置已保存");
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      toast.error(`保存失败: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-md:p-4" style={pageEnterStyle()}>
      <h2 className="text-lg font-bold mb-6 max-md:mb-4" style={{ color: "var(--text-primary)" }}>设置</h2>

      {!loaded ? (
        <div className="max-w-lg space-y-6">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} variant="card" height={80} />
          ))}
        </div>
      ) : (
      <div className="max-w-lg space-y-6">
        {/* Engine status */}
        <div className="glass-card p-4">
          <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>引擎状态</h3>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: connected ? "var(--green)" : "var(--red)" }} />
            <span className="text-xs" style={{ color: connected ? "var(--green)" : "var(--red)" }}>
              {connected ? "已连接 (ws://localhost:9731)" : "未连接"}
            </span>
          </div>
        </div>

        {/* Quality threshold */}
        <div className="glass-card p-4">
          <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>质量阈值</h3>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            低于此分数的任务将被回滚。当前: {(qualityThreshold * 100).toFixed(0)}%
          </p>
          <input type="range" min="0" max="100" value={qualityThreshold * 100}
            onChange={(e) => setQualityThreshold(Number(e.target.value) / 100)}
            aria-label={`质量阈值: 当前 ${(qualityThreshold * 100).toFixed(0)}%，范围 0% 到 100%`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(qualityThreshold * 100)}
            className="w-full" />
        </div>

        {/* Default timeout */}
        <div className="glass-card p-4">
          <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>默认超时时间</h3>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            每个任务的默认执行超时: {defaultTimeout} 分钟
          </p>
          <input type="range" min="5" max="180" value={defaultTimeout}
            onChange={(e) => setDefaultTimeout(Number(e.target.value))}
            aria-label={`默认超时时间: 当前 ${defaultTimeout} 分钟，范围 5 到 180 分钟`}
            aria-valuemin={5} aria-valuemax={180} aria-valuenow={defaultTimeout}
            className="w-full" />
        </div>

        {/* Claude path */}
        <div className="glass-card p-4">
          <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>Claude Code 路径</h3>
          <input type="text" value={claudePath} onChange={(e) => setClaudePath(e.target.value)}
            className="w-full px-3 py-2 rounded text-xs outline-none" style={{
              background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)",
            }} />
        </div>

        {/* Save button */}
        <button onClick={handleSave}
          className="px-6 py-2 rounded text-xs font-semibold disabled:opacity-40" style={{ background: "var(--blue)", color: "#0d1117" }}>
          {saved ? "已保存" : "保存设置"}
        </button>
      </div>
      )}
    </div>
  );
}
