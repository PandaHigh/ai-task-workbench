import { useEngine } from "../../hooks/useEngine";
import { useState } from "react";

export function SettingsPage() {
  const { connected, call } = useEngine();
  const [qualityThreshold, setQualityThreshold] = useState(0.6);
  const [defaultTimeout, setDefaultTimeout] = useState(60);
  const [claudePath, setClaudePath] = useState("claude");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    try {
      await call("config.set", { key: "qualityThreshold", value: qualityThreshold });
      await call("config.set", { key: "defaultTimeout", value: defaultTimeout });
      await call("config.set", { key: "claudePath", value: claudePath });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="text-lg font-bold mb-6" style={{ color: "var(--text-primary)" }}>设置</h2>

      <div className="max-w-lg space-y-6">
        {/* Engine status */}
        <div className="rounded-lg border p-4" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>引擎状态</h3>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: connected ? "var(--green)" : "var(--red)" }} />
            <span className="text-xs" style={{ color: connected ? "var(--green)" : "var(--red)" }}>
              {connected ? "已连接 (ws://localhost:9731)" : "未连接"}
            </span>
          </div>
        </div>

        {/* Quality threshold */}
        <div className="rounded-lg border p-4" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>质量阈值</h3>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            低于此分数的任务将被回滚。当前: {(qualityThreshold * 100).toFixed(0)}%
          </p>
          <input type="range" min="0" max="100" value={qualityThreshold * 100}
            onChange={(e) => setQualityThreshold(Number(e.target.value) / 100)}
            className="w-full" />
        </div>

        {/* Default timeout */}
        <div className="rounded-lg border p-4" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>默认超时时间</h3>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            每个任务的默认执行超时: {defaultTimeout} 分钟
          </p>
          <input type="range" min="5" max="180" value={defaultTimeout}
            onChange={(e) => setDefaultTimeout(Number(e.target.value))}
            className="w-full" />
        </div>

        {/* Claude path */}
        <div className="rounded-lg border p-4" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>Claude Code 路径</h3>
          <input type="text" value={claudePath} onChange={(e) => setClaudePath(e.target.value)}
            className="w-full px-3 py-2 rounded text-xs outline-none" style={{
              background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)",
            }} />
        </div>

        {/* Save button */}
        <button onClick={handleSave} className="px-6 py-2 rounded text-xs font-semibold" style={{ background: "var(--blue)", color: "#0d1117" }}>
          {saved ? "已保存 ✓" : "保存设置"}
        </button>
      </div>
    </div>
  );
}
