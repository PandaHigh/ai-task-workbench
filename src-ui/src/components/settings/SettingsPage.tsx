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
        const qt = await call("config.get", { key: "qualityThreshold" }) as { value?: unknown } | null;
        if (qt?.value != null) setQualityThreshold(Number(qt.value));
      } catch {
        toast.error("加载质量阈值失败");
      }
      try {
        const dt = await call("config.get", { key: "defaultTimeout" }) as { value?: unknown } | null;
        if (dt?.value != null) setDefaultTimeout(Number(dt.value));
      } catch {
        toast.error("加载超时设置失败");
      }
      try {
        const cp = await call("config.get", { key: "claudePath" }) as { value?: unknown } | null;
        if (cp?.value) setClaudePath(String(cp.value));
      } catch {
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
    <div className="flex-1 overflow-y-auto p-6" style={pageEnterStyle()}>
      <h2 className="text-lg font-bold mb-6" style={{ color: "var(--text-primary)" }}>设置</h2>

      {!loaded ? (
        <div className="max-w-lg space-y-6">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} variant="card" height={80} />
          ))}
        </div>
      ) : (
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
        <fieldset className="rounded-lg border p-4" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <legend className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>质量阈值</legend>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            低于此分数的任务将被回滚。当前: <span id="qt-value">{(qualityThreshold * 100).toFixed(0)}%</span>
          </p>
          <input type="range" id="quality-threshold" min="0" max="100" value={qualityThreshold * 100}
            onChange={(e) => setQualityThreshold(Number(e.target.value) / 100)}
            aria-labelledby="quality-threshold-label"
            aria-valuenow={Math.round(qualityThreshold * 100)}
            aria-valuemin={0} aria-valuemax={100}
            className="w-full" />
          <label id="quality-threshold-label" htmlFor="quality-threshold" className="sr-only">质量阈值百分比</label>
        </fieldset>

        {/* Default timeout */}
        <fieldset className="rounded-lg border p-4" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <legend className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>默认超时时间</legend>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            每个任务的默认执行超时: <span id="dt-value">{defaultTimeout} 分钟</span>
          </p>
          <input type="range" id="default-timeout" min="5" max="180" value={defaultTimeout}
            onChange={(e) => setDefaultTimeout(Number(e.target.value))}
            aria-labelledby="default-timeout-label"
            aria-valuenow={defaultTimeout}
            aria-valuemin={5} aria-valuemax={180}
            className="w-full" />
          <label id="default-timeout-label" htmlFor="default-timeout" className="sr-only">默认超时分钟数</label>
        </fieldset>

        {/* Claude path */}
        <fieldset className="rounded-lg border p-4" style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}>
          <legend className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>Claude Code 路径</legend>
          <input type="text" id="claude-path" value={claudePath} onChange={(e) => setClaudePath(e.target.value)}
            aria-label="Claude Code 可执行文件路径"
            className="w-full px-3 py-2 rounded text-xs outline-none" style={{
              background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)",
            }} />
        </fieldset>

        {/* Save button */}
        <button onClick={handleSave}
          aria-label={saved ? "设置已保存" : "保存设置"}
          className="px-6 py-2 rounded text-xs font-semibold disabled:opacity-40" style={{ background: "var(--blue)", color: "#0d1117" }}>
          {saved ? "已保存" : "保存设置"}
        </button>
      </div>
      )}
    </div>
  );
}
