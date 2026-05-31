import { useState, useEffect, useCallback } from "react";
import { useEngine } from "../../hooks/useEngine";
import { useToast } from "../common/Toast";

interface RemoteInfo {
  name: string;
  refs: Record<string, string>;
}

interface GitRemotePanelProps {
  workingDir?: string;
}

export function GitRemotePanel({ workingDir }: GitRemotePanelProps) {
  const { call } = useEngine();
  const toast = useToast();
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [branch, setBranch] = useState("");
  const [pushBranch, setPushBranch] = useState("");
  const [pullBranch, setPullBranch] = useState("");
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadRemotes = useCallback(async () => {
    if (!workingDir) return;
    setLoading(true);
    try {
      const list = await call("git.listRemotes", { workingDir }) as RemoteInfo[];
      setRemotes(list ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [call, workingDir]);

  const loadBranch = useCallback(async () => {
    if (!workingDir) return;
    try {
      const res = await call("git.currentBranch", { workingDir }) as string;
      setBranch(res ?? "");
    } catch { /* ignore */ }
  }, [call, workingDir]);

  useEffect(() => { loadRemotes(); loadBranch(); }, [loadRemotes, loadBranch]);

  const handlePush = async () => {
    if (!pushBranch.trim() || !workingDir) return;
    setActionLoading("push");
    try {
      await call("git.push", { workingDir, remote: remoteName, branch: pushBranch.trim() });
      toast.success(`已推送到 ${remoteName}/${pushBranch}`);
    } catch (err) { toast.error(`推送失败: ${err instanceof Error ? err.message : err}`); }
    setActionLoading(null);
  };

  const handlePull = async () => {
    if (!pullBranch.trim() || !workingDir) return;
    setActionLoading("pull");
    try {
      await call("git.pull", { workingDir, remote: remoteName, branch: pullBranch.trim() });
      toast.success(`已从 ${remoteName}/${pullBranch} 拉取`);
    } catch (err) { toast.error(`拉取失败: ${err instanceof Error ? err.message : err}`); }
    setActionLoading(null);
  };

  const handleFetch = async () => {
    if (!workingDir) return;
    setActionLoading("fetch");
    try {
      await call("git.fetch", { workingDir, remote: remoteName });
      toast.success(`已从 ${remoteName} 获取`);
    } catch (err) { toast.error(`获取失败: ${err instanceof Error ? err.message : err}`); }
    setActionLoading(null);
  };

  const handleAddRemote = async () => {
    if (!remoteName.trim() || !remoteUrl.trim() || !workingDir) return;
    setActionLoading("addRemote");
    try {
      await call("git.addRemote", { workingDir, name: remoteName.trim(), url: remoteUrl.trim() });
      toast.success(`已添加远程仓库 ${remoteName}`);
      setRemoteUrl("");
      loadRemotes();
    } catch (err) { toast.error(`添加失败: ${err instanceof Error ? err.message : err}`); }
    setActionLoading(null);
  };

  if (!workingDir) {
    return <p className="text-xs" style={{ color: "var(--text-secondary)" }}>请先选择项目目录</p>;
  }

  return (
    <div className="space-y-4">
      {/* Current branch */}
      {branch && (
        <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
          当前分支: <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{branch}</span>
        </div>
      )}

      {/* Remote list */}
      {loading ? (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>加载中...</p>
      ) : remotes.length > 0 ? (
        <div className="space-y-1.5">
          {remotes.map((r) => (
            <div key={r.name} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded" style={{ background: "var(--bg-tertiary)" }}>
              <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{r.name}</span>
              <span className="truncate text-[10px]" style={{ color: "var(--text-secondary)" }}>
                {r.refs?.fetch || r.refs?.push || "unknown"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>暂无远程仓库配置</p>
      )}

      {/* Actions */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input value={pushBranch} onChange={(e) => setPushBranch(e.target.value)} placeholder="分支名"
            className="flex-1 px-2 py-1.5 rounded text-xs outline-none"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
          <button onClick={handlePush} disabled={actionLoading !== null || !pushBranch.trim()}
            className="px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40"
            style={{ background: "var(--blue)", color: "#fff" }}>
            {actionLoading === "push" ? "推送中..." : "推送"}
          </button>
        </div>
        <div className="flex gap-2">
          <input value={pullBranch} onChange={(e) => setPullBranch(e.target.value)} placeholder="分支名"
            className="flex-1 px-2 py-1.5 rounded text-xs outline-none"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
          <button onClick={handlePull} disabled={actionLoading !== null || !pullBranch.trim()}
            className="px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40"
            style={{ background: "var(--green)", color: "#fff" }}>
            {actionLoading === "pull" ? "拉取中..." : "拉取"}
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={handleFetch} disabled={actionLoading !== null}
            className="px-3 py-1.5 rounded text-xs disabled:opacity-40"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
            {actionLoading === "fetch" ? "获取中..." : "Fetch"}
          </button>
        </div>
      </div>

      {/* Add remote */}
      <div className="pt-2 space-y-2" style={{ borderTop: "1px solid var(--border)" }}>
        <h4 className="text-[10px] font-bold" style={{ color: "var(--text-secondary)" }}>添加远程仓库</h4>
        <input value={remoteName} onChange={(e) => setRemoteName(e.target.value)} placeholder="名称 (如 origin)"
          className="w-full px-2 py-1.5 rounded text-xs outline-none"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
        <input value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="URL (如 git@github.com:user/repo.git)"
          className="w-full px-2 py-1.5 rounded text-xs outline-none"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
        <button onClick={handleAddRemote} disabled={actionLoading !== null || !remoteUrl.trim()}
          className="w-full px-3 py-2 rounded text-xs font-semibold disabled:opacity-40"
          style={{ background: "var(--green)", color: "#fff" }}>
          添加
        </button>
      </div>
    </div>
  );
}
