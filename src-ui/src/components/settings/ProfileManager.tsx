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

  useEffect(() => {
    if (!connected) return;
    Promise.all([
      call("profile.list", {}),
      call("config.get", { key: "activeProfile" }),
    ]).then(([list, active]) => {
      setProfiles((list ?? []) as OrchestratorProfile[]);
      setActiveId((active as string) ?? "adaptive");
    }).catch(() => {});
  }, [connected, call]);

  const activate = async (id: string) => {
    await call("config.set", { key: "activeProfile", value: id });
    setActiveId(id);
  };

  const remove = async (id: string) => {
    await call("profile.delete", { id });
    if (activeId === id) {
      await call("config.set", { key: "activeProfile", value: null });
      setActiveId(null);
    }
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="space-y-2">
      {profiles.map((profile) => (
        <div
          key={profile.id}
          role="button"
          tabIndex={0}
          className="p-2 rounded flex items-center justify-between cursor-pointer"
          style={{
            background: activeId === profile.id ? "rgba(77, 107, 254, 0.12)" : "var(--bg-tertiary)",
            border: activeId === profile.id ? "1px solid var(--blue)" : "1px solid transparent",
          }}
          onClick={() => activate(profile.id)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(profile.id); } }}
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
    </div>
  );
}
