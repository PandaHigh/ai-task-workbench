import { useState, useEffect } from "react";
import { useEngine } from "../../hooks/useEngine";
import type { OrchestratorProfile } from "@ai-workbench/shared";

const MODE_LABELS: Record<string, string> = {
  sequential: "顺序执行",
  fixloop: "修复循环",
  parallel: "并行执行",
  adaptive: "自适应",
};

export function ProfileManager() {
  const { connected, call } = useEngine();
  const [profiles, setProfiles] = useState<OrchestratorProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<OrchestratorProfile> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!connected) return;
    Promise.all([
      call("profile.list", {}),
      call("config.get", { key: "activeProfile" }),
    ]).then(([list, active]) => {
      setProfiles((list ?? []) as OrchestratorProfile[]);
      setActiveId((active as string) ?? null);
    }).catch(() => {});
  }, [connected, call]);

  const activate = async (id: string) => {
    await call("config.set", { key: "activeProfile", value: id });
    setActiveId(id);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const profile: OrchestratorProfile = {
        id: editing.id || `custom-${Date.now().toString(36)}`,
        name: editing.name || "自定义配置",
        description: editing.description || "",
        isBuiltIn: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        config: editing.config ?? {
          mode: "fixloop",
          maxFixIterations: 3,
          qualityThreshold: 0.6,
          timeoutMinutes: 30,
          backgroundReview: false,
          errorWatchEnabled: true,
          agents: {
            planner: { maxTurns: 15, enabled: true },
            developer: { maxTurns: 40, enabled: true },
            tester: { maxTurns: 25, enabled: true },
            reviewer: { maxTurns: 20, enabled: true },
          },
        },
      };
      await call("profile.set", { profile });
      setEditing(null);
      const list = await call("profile.list", {});
      setProfiles((list ?? []) as OrchestratorProfile[]);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await call("profile.delete", { id });
    if (activeId === id) {
      await call("config.set", { key: "activeProfile", value: null });
      setActiveId(null);
    }
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  };

  if (editing) {
    const cfg = editing.config!;
    return (
      <div className="p-3 rounded text-xs" style={{ background: "var(--bg-tertiary)" }}>
        <div className="font-bold mb-3" style={{ color: "var(--text-primary)" }}>
          {editing.id ? "编辑配置" : "创建配置"}
        </div>
        <div className="space-y-3">
          <div>
            <label className="block mb-1" style={{ color: "var(--text-secondary)" }}>名称</label>
            <input
              value={editing.name ?? ""}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="w-full px-2 py-1 rounded text-xs"
              style={{ background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            />
          </div>
          <div>
            <label className="block mb-1" style={{ color: "var(--text-secondary)" }}>执行模式</label>
            <select
              value={cfg.mode}
              onChange={(e) => setEditing({ ...editing, config: { ...cfg, mode: e.target.value as OrchestratorProfile["config"]["mode"] } })}
              className="w-full px-2 py-1 rounded text-xs"
              style={{ background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            >
              {Object.entries(MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block mb-1" style={{ color: "var(--text-secondary)" }}>质量阈值: {cfg.qualityThreshold}</label>
              <input type="range" min="0.1" max="1" step="0.05" value={cfg.qualityThreshold}
                onChange={(e) => setEditing({ ...editing, config: { ...cfg, qualityThreshold: parseFloat(e.target.value) } })}
                className="w-full"
              />
            </div>
            <div>
              <label className="block mb-1" style={{ color: "var(--text-secondary)" }}>修复次数: {cfg.maxFixIterations}</label>
              <input type="range" min="1" max="10" step="1" value={cfg.maxFixIterations}
                onChange={(e) => setEditing({ ...editing, config: { ...cfg, maxFixIterations: parseInt(e.target.value) } })}
                className="w-full"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={cfg.backgroundReview}
                onChange={(e) => setEditing({ ...editing, config: { ...cfg, backgroundReview: e.target.checked } })}
              />
              <span style={{ color: "var(--text-secondary)" }}>后台审查</span>
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={cfg.errorWatchEnabled}
                onChange={(e) => setEditing({ ...editing, config: { ...cfg, errorWatchEnabled: e.target.checked } })}
              />
              <span style={{ color: "var(--text-secondary)" }}>错误监控</span>
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="px-3 py-1 rounded text-xs font-semibold"
              style={{ background: "var(--blue)", color: "#fff", opacity: saving ? 0.5 : 1 }}
            >
              {saving ? "保存中..." : "保存"}
            </button>
            <button onClick={() => setEditing(null)}
              className="px-3 py-1 rounded text-xs"
              style={{ background: "var(--bg-primary)", color: "var(--text-secondary)" }}
            >
              取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {profiles.map((profile) => (
        <div
          key={profile.id}
          className="p-2 rounded flex items-center justify-between cursor-pointer"
          style={{
            background: activeId === profile.id ? "rgba(77, 107, 254, 0.12)" : "var(--bg-tertiary)",
            border: activeId === profile.id ? "1px solid var(--blue)" : "1px solid transparent",
          }}
          onClick={() => activate(profile.id)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{profile.name}</span>
              {profile.isBuiltIn && (
                <span className="text-[10px] px-1 rounded" style={{ background: "var(--bg-primary)", color: "var(--text-secondary)" }}>内置</span>
              )}
              <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{MODE_LABELS[profile.config.mode]}</span>
            </div>
            <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{profile.description}</div>
          </div>
          <div className="flex items-center gap-1">
            {!profile.isBuiltIn && (
              <button
                onClick={(e) => { e.stopPropagation(); remove(profile.id); }}
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ color: "var(--red)" }}
              >
                删除
              </button>
            )}
          </div>
        </div>
      ))}
      <button
        onClick={() => setEditing({
          id: "",
          name: "",
          description: "",
          config: {
            mode: "fixloop",
            maxFixIterations: 3,
            qualityThreshold: 0.6,
            timeoutMinutes: 30,
            backgroundReview: false,
            errorWatchEnabled: true,
            agents: {
              planner: { maxTurns: 15, enabled: true },
              developer: { maxTurns: 40, enabled: true },
              tester: { maxTurns: 25, enabled: true },
              reviewer: { maxTurns: 20, enabled: true },
            },
          },
        })}
        className="w-full p-2 rounded text-xs font-semibold"
        style={{ background: "var(--bg-tertiary)", color: "var(--blue-light)", border: "1px dashed var(--border)" }}
      >
        + 创建自定义配置
      </button>
    </div>
  );
}
