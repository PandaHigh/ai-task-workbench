import { useEngine } from "../../hooks/useEngine";
import { useState, useEffect, useCallback } from "react";
import { useToast } from "../common/Toast";

// ─── Types ─────────────────────────────────────────────────────────────────

interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface PluginEntry {
  id: string;
  name: string;
  description: string;
  type: "mcp-server";
  config: McpServerConfig;
  enabled: boolean;
  status: "stopped" | "running" | "error";
  startedAt?: number;
  error?: string;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function PluginManager() {
  const { connected, call } = useEngine();
  const toast = useToast();
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  // Add-form state
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCommand, setAddCommand] = useState("");
  const [addArgs, setAddArgs] = useState("");
  const [adding, setAdding] = useState(false);

  const loadPlugins = useCallback(async () => {
    if (!connected) return;
    try {
      const result = await call("plugin.list", {});
      setPlugins((result as PluginEntry[]) || []);
    } catch (err) {
      toast.error(
        `加载插件列表失败: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      setLoading(false);
    }
  }, [connected, call, toast]);

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!addName.trim() || !addCommand.trim()) {
      toast.error("名称和命令不能为空");
      return;
    }
    setAdding(true);
    try {
      await call("plugin.install", {
        name: addName.trim(),
        command: addCommand.trim(),
        args: addArgs
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
      });
      toast.success(`插件 "${addName.trim()}" 已添加`);
      setAddName("");
      setAddCommand("");
      setAddArgs("");
      setShowAdd(false);
      await loadPlugins();
    } catch (err) {
      toast.error(
        `添加失败: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    setDeleting(id);
    try {
      await call("plugin.remove", { id });
      toast.success("插件已删除");
      setConfirmDelete(null);
      await loadPlugins();
    } catch (err) {
      toast.error(
        `删除失败: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      setDeleting(null);
    }
  };

  const handleToggle = async (plugin: PluginEntry) => {
    setToggling(plugin.id);
    try {
      await call("plugin.toggle", { id: plugin.id, enabled: !plugin.enabled });
      await loadPlugins();
    } catch (err) {
      toast.error(
        `切换失败: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      setToggling(null);
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────

  const statusColor = (status: PluginEntry["status"]) => {
    switch (status) {
      case "running":
        return "var(--green)";
      case "error":
        return "var(--red)";
      default:
        return "var(--text-secondary)";
    }
  };

  const statusLabel = (status: PluginEntry["status"]) => {
    switch (status) {
      case "running":
        return "运行中";
      case "error":
        return "错误";
      default:
        return "已停止";
    }
  };

  // ── Loading skeleton ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="glass-card p-3 animate-pulse"
            style={{ height: 48 }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Plugin list */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3
            className="text-xs font-bold"
            style={{ color: "var(--text-secondary)" }}
          >
            MCP Server 插件 ({plugins.length})
          </h3>
          <button
            onClick={() => setShowAdd(!showAdd)}
            disabled={!connected}
            className="px-3 py-1 rounded text-[10px] font-semibold disabled:opacity-40"
            style={{ background: "var(--blue)", color: "#fff" }}
          >
            {showAdd ? "取消" : "添加插件"}
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <div
            className="mb-3 p-3 rounded space-y-2"
            style={{ background: "var(--bg-tertiary)" }}
          >
            <input
              type="text"
              placeholder="插件名称 (例如: my-mcp-server)"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              className="w-full px-3 py-1.5 rounded text-xs outline-none"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                border: "1px solid var(--border)",
              }}
            />
            <input
              type="text"
              placeholder="启动命令 (例如: npx)"
              value={addCommand}
              onChange={(e) => setAddCommand(e.target.value)}
              className="w-full px-3 py-1.5 rounded text-xs outline-none"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                border: "1px solid var(--border)",
              }}
            />
            <input
              type="text"
              placeholder="参数，逗号分隔 (例如: -y, @modelcontextprotocol/server-memory)"
              value={addArgs}
              onChange={(e) => setAddArgs(e.target.value)}
              className="w-full px-3 py-1.5 rounded text-xs outline-none"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                border: "1px solid var(--border)",
              }}
            />
            <button
              onClick={handleAdd}
              disabled={adding || !addName.trim() || !addCommand.trim()}
              className="px-3 py-1 rounded text-[10px] font-semibold disabled:opacity-40"
              style={{ background: "var(--green)", color: "#fff" }}
            >
              {adding ? "添加中..." : "确认添加"}
            </button>
          </div>
        )}

        {/* Empty state */}
        {plugins.length === 0 ? (
          <div
            className="text-center py-4"
            style={{ border: "1px dashed var(--border)", borderRadius: 8 }}
          >
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              暂无 MCP Server 插件
            </p>
            <p
              className="text-[10px] mt-1"
              style={{ color: "var(--text-secondary)" }}
            >
              点击上方"添加插件"按钮安装 MCP Server
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {plugins.map((plugin) => (
              <div
                key={plugin.id}
                className="flex items-center justify-between gap-2 p-2 rounded"
                style={{ background: "var(--bg-tertiary)" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {/* Status indicator */}
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: statusColor(plugin.status) }}
                      title={statusLabel(plugin.status)}
                    />
                    <span
                      className="text-xs font-semibold truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {plugin.name}
                    </span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        background:
                          plugin.status === "running"
                            ? "var(--green)"
                            : "var(--border)",
                        color:
                          plugin.status === "running"
                            ? "#fff"
                            : "var(--text-secondary)",
                        opacity: plugin.status === "running" ? 0.8 : 1,
                      }}
                    >
                      {statusLabel(plugin.status)}
                    </span>
                  </div>
                  <p
                    className="text-[10px] mt-0.5 truncate"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {plugin.config.command} {plugin.config.args.join(" ")}
                  </p>
                  {plugin.error && (
                    <p
                      className="text-[10px] mt-0.5 truncate"
                      style={{ color: "var(--red)" }}
                    >
                      {plugin.error}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {/* Enable/disable toggle */}
                  <button
                    onClick={() => handleToggle(plugin)}
                    disabled={toggling === plugin.id}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold disabled:opacity-40"
                    style={{
                      background: plugin.enabled
                        ? "var(--green)"
                        : "var(--border)",
                      color: plugin.enabled ? "#fff" : "var(--text-secondary)",
                    }}
                  >
                    {toggling === plugin.id
                      ? "..."
                      : plugin.enabled
                        ? "已启用"
                        : "已禁用"}
                  </button>

                  {/* Delete button */}
                  {confirmDelete === plugin.id ? (
                    <>
                      <button
                        onClick={() => handleRemove(plugin.id)}
                        disabled={deleting === plugin.id}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold"
                        style={{ background: "var(--red)", color: "#fff" }}
                      >
                        {deleting === plugin.id ? "..." : "确认"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-2 py-0.5 rounded text-[10px]"
                        style={{
                          background: "var(--border)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(plugin.id)}
                      className="text-[10px] opacity-50 hover:opacity-100"
                      style={{ color: "var(--red)" }}
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
