import { useEngine } from "../../hooks/useEngine";
import { useState, useEffect, useCallback } from "react";
import { Skeleton } from "../common/Skeleton";
import { useToast } from "../common/Toast";
import { pageEnterStyle } from "../../hooks/useAnimations";

interface OrigValues {
  qualityThreshold: number;
  defaultTimeout: number;
  claudePath: string;
}

const CONSTRAINTS = {
  qualityThreshold: { min: 0, max: 1, step: 0.05, label: "质量阈值" },
  defaultTimeout: { min: 5, max: 180, step: 5, label: "默认超时时间" },
} as const;

function validateNumber(value: number, min: number, max: number, label: string): string {
  if (Number.isNaN(value)) return `${label}必须是有效数字`;
  if (value < min) return `${label}不能低于 ${min}`;
  if (value > max) return `${label}不能超过 ${max}`;
  return "";
}

export function SettingsPage() {
  const { connected, call } = useEngine();
  const toast = useToast();
  const [qualityThreshold, setQualityThreshold] = useState(0.6);
  const [defaultTimeout, setDefaultTimeout] = useState(60);
  const [claudePath, setClaudePath] = useState("claude");
  const [claudePathError, setClaudePathError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [origValues, setOrigValues] = useState<OrigValues | null>(null);
  const [publicUrl, setPublicUrl] = useState("");

  const isDirty = origValues != null && (
    origValues.qualityThreshold !== qualityThreshold
    || origValues.defaultTimeout !== defaultTimeout
    || origValues.claudePath !== claudePath
  );

  const qtError = validateNumber(qualityThreshold, CONSTRAINTS.qualityThreshold.min, CONSTRAINTS.qualityThreshold.max, CONSTRAINTS.qualityThreshold.label);
  const dtError = validateNumber(defaultTimeout, CONSTRAINTS.defaultTimeout.min, CONSTRAINTS.defaultTimeout.max, CONSTRAINTS.defaultTimeout.label);

  const validateClaudePath = useCallback((value: string) => {
    if (!value.trim()) {
      setClaudePathError("Claude Code 路径不能为空");
      return false;
    }
    if (value.trim().length < 1) {
      setClaudePathError("路径至少 1 个字符");
      return false;
    }
    setClaudePathError("");
    return true;
  }, []);

  useEffect(() => {
    if (!connected) return;
    let qt = 0.6;
    let dt = 60;
    let cp = "claude";
    let cancelled = false;

    const load = async () => {
      try {
        const res = await call("config.get", { key: "qualityThreshold" });
        const val = (res as Record<string, unknown> | null)?.value;
        if (val != null) qt = Number(val);
      } catch (err) {
        console.warn("Failed to load quality threshold:", err instanceof Error ? err.message : err);
        toast.error("加载质量阈值失败");
      }
      try {
        const res = await call("config.get", { key: "defaultTimeout" });
        const val = (res as Record<string, unknown> | null)?.value;
        if (val != null) dt = Number(val);
      } catch (err) {
        console.warn("Failed to load default timeout:", err instanceof Error ? err.message : err);
        toast.error("加载超时设置失败");
      }
      try {
        const res = await call("config.get", { key: "claudePath" });
        const val = (res as Record<string, unknown> | null)?.value;
        if (val) cp = String(val);
      } catch (err) {
        console.warn("Failed to load claude path:", err instanceof Error ? err.message : err);
        toast.error("加载 Claude 路径失败");
      }

      let pu = "";
      try {
        const res = await call("config.get", { key: "publicUrl" });
        const val = (res as Record<string, unknown> | null)?.value;
        if (val) pu = String(val);
      } catch { /* ignore */ }

      if (cancelled) return;
      setQualityThreshold(qt);
      setDefaultTimeout(dt);
      setClaudePath(cp);
      setPublicUrl(pu);
      setOrigValues({ qualityThreshold: qt, defaultTimeout: dt, claudePath: cp });
      setLoaded(true);
    };
    load();
    return () => { cancelled = true; };
  }, [connected]);

  const handleSave = async () => {
    if (qtError || dtError) {
      toast.error("请修正验证错误后再保存");
      return;
    }
    if (!validateClaudePath(claudePath)) return;
    try {
      await call("config.set", { key: "qualityThreshold", value: qualityThreshold });
      await call("config.set", { key: "defaultTimeout", value: defaultTimeout });
      await call("config.set", { key: "claudePath", value: claudePath });
      await call("config.set", { key: "publicUrl", value: publicUrl });
      setOrigValues({ qualityThreshold, defaultTimeout, claudePath });
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
          <div className="flex items-center gap-2 mt-2">
            <input type="number" min={CONSTRAINTS.qualityThreshold.min} max={CONSTRAINTS.qualityThreshold.max}
              step={CONSTRAINTS.qualityThreshold.step}
              value={qualityThreshold}
              onChange={(e) => setQualityThreshold(Number(e.target.value))}
              className="w-20 px-2 py-1 rounded text-xs outline-none"
              style={{
                background: "var(--bg-tertiary)", color: "var(--text-primary)",
                border: qtError ? "1px solid var(--red)" : "1px solid var(--border)",
              }}
              aria-label="质量阈值数值输入"
            />
            {qtError && <span className="text-xs" style={{ color: "var(--red)" }} role="alert">{qtError}</span>}
          </div>
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
          <div className="flex items-center gap-2 mt-2">
            <input type="number" min={CONSTRAINTS.defaultTimeout.min} max={CONSTRAINTS.defaultTimeout.max}
              step={CONSTRAINTS.defaultTimeout.step}
              value={defaultTimeout}
              onChange={(e) => setDefaultTimeout(Number(e.target.value))}
              className="w-20 px-2 py-1 rounded text-xs outline-none"
              style={{
                background: "var(--bg-tertiary)", color: "var(--text-primary)",
                border: dtError ? "1px solid var(--red)" : "1px solid var(--border)",
              }}
              aria-label="超时时间数值输入"
            />
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>分钟</span>
            {dtError && <span className="text-xs" style={{ color: "var(--red)" }} role="alert">{dtError}</span>}
          </div>
        </div>

        {/* Claude path */}
        <div className="glass-card p-4">
          <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>Claude Code 路径</h3>
          <input type="text" value={claudePath}
            onChange={(e) => {
              setClaudePath(e.target.value);
              if (claudePathError) validateClaudePath(e.target.value);
            }}
            onBlur={() => validateClaudePath(claudePath)}
            required
            minLength={1}
            className="w-full px-3 py-2 rounded text-xs outline-none"
            style={{
              background: "var(--bg-tertiary)", color: "var(--text-primary)",
              border: claudePathError ? "1px solid var(--red)" : "1px solid var(--border)",
            }}
            aria-invalid={!!claudePathError}
            aria-describedby={claudePathError ? "claude-path-error" : undefined}
          />
          {claudePathError && (
            <p id="claude-path-error" className="text-xs mt-1" style={{ color: "var(--red)" }} role="alert">{claudePathError}</p>
          )}
        </div>

        {/* Share settings */}
        <div className="glass-card p-4">
          <h3 className="text-xs font-bold mb-3" style={{ color: "var(--text-secondary)" }}>分享设置</h3>
          <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
            公网访问地址，用于生成分享链接（如使用 ngrok 或端口转发后的地址）
          </p>
          <input type="text" value={publicUrl}
            onChange={(e) => setPublicUrl(e.target.value)}
            placeholder="https://my-tunnel.ngrok.io"
            className="w-full px-3 py-2 rounded text-xs outline-none"
            style={{
              background: "var(--bg-tertiary)", color: "var(--text-primary)",
              border: "1px solid var(--border)",
            }}
          />
          <p className="text-[10px] mt-1" style={{ color: "var(--text-secondary)" }}>
            留空则使用 http://localhost:9731
          </p>
        </div>

        {/* Save button */}
        <button onClick={handleSave} disabled={!isDirty || !!qtError || !!dtError}
          className="px-6 py-2 rounded text-xs font-semibold disabled:opacity-40"
          style={{ background: "var(--blue)", color: "#0d1117" }}>
          {saved ? "已保存" : isDirty ? "保存设置" : "未修改"}
        </button>
      </div>
      )}
    </div>
  );
}
