import { useEngine } from "../../hooks/useEngine";
import { useState, useEffect } from "react";
import { useToast } from "../common/Toast";

interface WeComStatus {
  enabled: boolean;
  connected: boolean;
  botId?: string;
}

export function WeComConfig() {
  const { connected, call } = useEngine();
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [botId, setBotId] = useState("");
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<WeComStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTarget, setTestTarget] = useState("");

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;

    const load = async () => {
      const [enRes, bidRes, secRes, stRes] = await Promise.allSettled([
        call("config.get", { key: "wecom.enabled" }),
        call("config.get", { key: "wecom.botId" }),
        call("config.get", { key: "wecom.secret" }),
        call("wecom.status"),
      ]);

      if (cancelled) return;

      if (enRes.status === "fulfilled") {
        const v = (enRes.value as Record<string, unknown>)?.value;
        setEnabled(v === true || v === "true");
      }
      if (bidRes.status === "fulfilled") {
        const v = (bidRes.value as Record<string, unknown>)?.value;
        if (v && typeof v === "string") setBotId(v);
      }
      if (secRes.status === "fulfilled") {
        const v = (secRes.value as Record<string, unknown>)?.value;
        if (v && typeof v === "string") setSecret(v);
      }
      if (stRes.status === "fulfilled") {
        setStatus(stRes.value as WeComStatus);
      }

      setLoaded(true);
    };
    load();
    return () => { cancelled = true; };
  }, [connected]);

  const refreshStatus = async () => {
    try {
      const res = await call("wecom.status");
      setStatus(res as WeComStatus);
    } catch {
      // ignore
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await call("config.set", { key: "wecom.enabled", value: enabled });
      await call("config.set", { key: "wecom.botId", value: botId });
      await call("config.set", { key: "wecom.secret", value: secret });
      toast.success("企业微信配置已保存。如修改了凭据，需要重启引擎才能生效。");
      await refreshStatus();
    } catch (err) {
      toast.error(`保存失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testTarget.trim()) {
      toast.error("请填写测试目标 ID");
      return;
    }
    setTesting(true);
    try {
      await call("wecom.test", { target: testTarget, content: "**PandaAI 测试消息**\n> 企业微信机器人连接正常" });
      toast.success("测试消息已发送");
    } catch (err) {
      toast.error(`发送失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setTesting(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="glass-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>企业微信机器人</h3>
        <div className="flex items-center gap-2">
          {status && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: status.connected ? "var(--green)" : "var(--text-secondary)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.connected ? "var(--green)" : "var(--text-secondary)" }} />
              {status.connected ? "已连接" : status.enabled ? "未连接" : "未启用"}
            </span>
          )}
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}
              className="w-3.5 h-3.5 rounded" />
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>启用</span>
          </label>
        </div>
      </div>

      <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
        接入企业微信智能机器人（长连接模式），无需公网 IP 和域名。在企业微信管理后台获取 Bot ID 和 Secret。
      </p>

      <div>
        <label className="text-[10px] block mb-1" style={{ color: "var(--text-secondary)" }}>Bot ID</label>
        <input type="text" value={botId} onChange={(e) => setBotId(e.target.value)}
          placeholder="企业微信后台 → 智能机器人 → API Mode"
          className="w-full px-3 py-1.5 rounded text-xs outline-none"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
        />
      </div>

      <div>
        <label className="text-[10px] block mb-1" style={{ color: "var(--text-secondary)" }}>Secret</label>
        <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)}
          placeholder="长连接专用密钥"
          className="w-full px-3 py-1.5 rounded text-xs outline-none"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-1.5 rounded text-xs font-semibold disabled:opacity-40"
          style={{ background: "var(--blue)", color: "#fff" }}>
          {saving ? "保存中..." : "保存配置"}
        </button>

        <div className="flex items-center gap-1 ml-auto">
          <input type="text" value={testTarget} onChange={(e) => setTestTarget(e.target.value)}
            placeholder="用户ID或群聊ID"
            className="w-32 px-2 py-1.5 rounded text-[10px] outline-none"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
          />
          <button onClick={handleTest} disabled={testing || !status?.connected}
            className="px-3 py-1.5 rounded text-[10px] font-semibold disabled:opacity-40"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}>
            {testing ? "发送中..." : "测试"}
          </button>
        </div>
      </div>
    </div>
  );
}
