import { useState, useEffect } from "react";
import { useEngine } from "../../hooks/useEngine";
import type { ClientSession } from "@ai-workbench/shared";

export function PresencePanel() {
  const { call } = useEngine();
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const result = (await call("session.list", {})) as { sessions: ClientSession[] };
        setSessions(result.sessions);
      } catch { /* ignore */ }
      setLoaded(true);
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [call]);

  if (!loaded || sessions.length <= 1) return null;

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>在线用户</h4>
      {sessions.map((s) => (
        <div key={s.sessionId} className="flex items-center gap-2 text-xs">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--green)" }} />
          <span style={{ color: "var(--text-primary)" }}>{s.displayName}</span>
          <span className="text-[10px] px-1 rounded" style={{
            background: s.role === "owner" ? "rgba(234,179,8,0.15)" : s.role === "collaborator" ? "rgba(59,130,246,0.15)" : "var(--bg-primary)",
            color: s.role === "owner" ? "var(--yellow)" : s.role === "collaborator" ? "var(--blue)" : "var(--text-secondary)",
          }}>
            {s.role}
          </span>
        </div>
      ))}
    </div>
  );
}
