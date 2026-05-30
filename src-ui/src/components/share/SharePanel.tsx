import { useState, useEffect, useCallback } from "react";
import { useToast } from "../common/Toast";
import type { ShareToken } from "@ai-workbench/shared";

interface SharePanelProps {
  open: boolean;
  onClose: () => void;
  runId: string;
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

type ExpiryOption = "never" | "1h" | "1d" | "7d";

const EXPIRY_OPTIONS: { value: ExpiryOption; label: string }[] = [
  { value: "never", label: "永不过期" },
  { value: "1h", label: "1 小时" },
  { value: "1d", label: "1 天" },
  { value: "7d", label: "7 天" },
];

function getExpiresAt(option: ExpiryOption): number | null {
  const now = Date.now();
  switch (option) {
    case "never": return null;
    case "1h": return now + 3600_000;
    case "1d": return now + 86400_000;
    case "7d": return now + 604800_000;
  }
}

function formatExpiry(expiresAt: number | null): string {
  if (!expiresAt) return "永不过期";
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "已过期";
  if (diff < 3600_000) return `${Math.ceil(diff / 60_000)} 分钟后过期`;
  if (diff < 86400_000) return `${Math.ceil(diff / 3600_000)} 小时后过期`;
  return `${Math.ceil(diff / 86400_000)} 天后过期`;
}

function formatCreatedAt(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function SharePanel({ open, onClose, runId, call }: SharePanelProps) {
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState<ExpiryOption>("never");
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const toast = useToast();

  const loadTokens = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const list = await call("share.list", { runId }) as ShareToken[];
      setTokens(list || []);
    } catch (err) {
      console.warn("Failed to load share tokens:", err);
    } finally {
      setLoading(false);
    }
  }, [runId, call]);

  useEffect(() => {
    if (open) {
      setCreatedUrl(null);
      setLabel("");
      setExpiry("never");
      loadTokens();
    }
  }, [open, loadTokens]);

  const handleCreate = async () => {
    if (!runId || creating) return;
    setCreating(true);
    try {
      const expiresAt = getExpiresAt(expiry);
      const result = await call("share.create", {
        runId,
        label: label.trim() || undefined,
        expiresAt: expiresAt ?? undefined,
      }) as { token: string; url: string; createdAt: number };
      setCreatedUrl(result.url);
      toast.success("分享链接已创建");
      await loadTokens();
    } catch (err) {
      toast.error(`创建失败: ${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (url: string, tokenId: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(tokenId);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const handleNativeShare = async (url: string) => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "AI 任务看板", url });
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error("分享失败");
      }
    }
  };

  const handleRevoke = async (token: string) => {
    try {
      await call("share.revoke", { token });
      toast.success("已撤销");
      await loadTokens();
      if (createdUrl && tokens.find(t => t.token === token)) {
        setCreatedUrl(null);
      }
    } catch (err) {
      toast.error(`撤销失败: ${err instanceof Error ? err.message : "未知错误"}`);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col"
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          animation: "slideUp 0.2s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>分享管理</h3>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded" style={{ color: "var(--text-secondary)", background: "var(--bg-tertiary)" }}>关闭</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Create form */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>创建分享链接</h4>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={'标签（可选，如张三、外部审查）'}
              className="w-full px-3 py-2 rounded-lg text-xs outline-none"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            />
            <div className="flex gap-2 flex-wrap">
              {EXPIRY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setExpiry(opt.value)}
                  className="px-3 py-1.5 rounded text-xs font-medium"
                  style={{
                    background: expiry === opt.value ? "var(--blue)" : "var(--bg-tertiary)",
                    color: expiry === opt.value ? "#fff" : "var(--text-secondary)",
                    border: expiry === opt.value ? "1px solid var(--blue)" : "1px solid var(--border)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="w-full px-4 py-2.5 rounded-lg text-xs font-semibold"
              style={{
                background: creating ? "var(--bg-tertiary)" : "var(--green)",
                color: creating ? "var(--text-secondary)" : "#fff",
                opacity: creating ? 0.7 : 1,
              }}
            >
              {creating ? "创建中..." : "创建链接"}
            </button>
          </div>

          {/* Created URL display */}
          {createdUrl && (
            <div className="p-3 rounded-lg space-y-2" style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
              <p className="text-xs font-semibold" style={{ color: "var(--green)" }}>链接已创建</p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={createdUrl}
                  className="flex-1 px-2 py-1.5 rounded text-xs outline-none"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => handleCopy(createdUrl, "created")}
                  className="px-3 py-1.5 rounded text-xs font-semibold shrink-0"
                  style={{ background: "var(--blue)", color: "#fff" }}
                >
                  {copied === "created" ? "已复制" : "复制"}
                </button>
                {typeof navigator.share === "function" && (
                  <button
                    onClick={() => handleNativeShare(createdUrl)}
                    className="px-3 py-1.5 rounded text-xs font-semibold shrink-0"
                    style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                  >
                    分享
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Token list */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
              已有链接 ({tokens.length})
            </h4>
            {loading ? (
              <div className="flex justify-center py-4">
                <div className="animate-spin w-5 h-5 border-2 border-t-transparent rounded-full" style={{ borderColor: "var(--blue)", borderTopColor: "transparent" }} />
              </div>
            ) : tokens.length === 0 ? (
              <p className="text-xs text-center py-4" style={{ color: "var(--text-secondary)" }}>还没有分享链接</p>
            ) : (
              <div className="space-y-2">
                {tokens.map((t) => {
                  const tokenUrl = `${window.location.origin}/#/share/${t.token}`;
                  const isExpired = t.expiresAt !== null && Date.now() > t.expiresAt;
                  return (
                    <div
                      key={t.token}
                      className="px-3 py-2.5 rounded-lg text-xs"
                      style={{
                        background: "var(--bg-tertiary)",
                        border: "1px solid var(--border)",
                        opacity: isExpired ? 0.5 : 1,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="font-mono text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>
                            {t.token.slice(0, 8)}...
                          </span>
                          {t.label && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] shrink-0" style={{ background: "rgba(77, 107, 254, 0.15)", color: "var(--blue)" }}>
                              {t.label}
                            </span>
                          )}
                          {isExpired && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] shrink-0" style={{ background: "rgba(239, 68, 68, 0.15)", color: "var(--red)" }}>
                              已过期
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleCopy(tokenUrl, t.token)}
                            className="px-2 py-1 rounded text-[10px] font-semibold"
                            style={{ background: "var(--blue)", color: "#fff" }}
                          >
                            {copied === t.token ? "已复制" : "复制"}
                          </button>
                          <button
                            onClick={() => handleRevoke(t.token)}
                            className="px-2 py-1 rounded text-[10px] font-semibold"
                            style={{ background: "var(--red)", color: "#fff" }}
                          >
                            撤销
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-3 text-[10px]" style={{ color: "var(--text-secondary)" }}>
                        <span>{formatCreatedAt(t.createdAt)}</span>
                        <span>{formatExpiry(t.expiresAt)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
