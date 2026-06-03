import { useParams } from "react-router-dom";
import { useShareView } from "../../hooks/useShareView";
import { useEvolutionStore } from "../../stores/evolution-store";
import { EvolutionDashboard } from "../evolution/EvolutionDashboard";
import { useEffect, useRef, useCallback } from "react";

export function ShareDashboard() {
  const { token } = useParams<{ token: string }>();
  const { loading, error, run, commits, lessons, queue, logs, call, refresh, wsConnected } = useShareView(token!);

  const setQueue = useEvolutionStore((s) => s.setQueue);
  const setCommits = useEvolutionStore((s) => s.setCommits);
  const setLessons = useEvolutionStore((s) => s.setLessons);
  const setLogs = useEvolutionStore((s) => s.setLogs);
  const setRunning = useEvolutionStore((s) => s.setRunning);
  const reset = useEvolutionStore((s) => s.reset);

  const prevRunIdRef = useRef<string | null>(null);

  // Reset store when run changes
  useEffect(() => {
    const runId = run?.id ?? null;
    if (runId && runId !== prevRunIdRef.current) {
      if (prevRunIdRef.current) reset();
      prevRunIdRef.current = runId;
    }
  }, [run?.id, reset]);

  // Sync share data to evolution store
  useEffect(() => { setQueue(queue); }, [queue, setQueue]);
  useEffect(() => { setCommits(commits); }, [commits, setCommits]);
  useEffect(() => { setLessons(lessons); }, [lessons, setLessons]);
  useEffect(() => { setLogs(logs); }, [logs, setLogs]);
  useEffect(() => {
    if (run) setRunning(run.status === "running");
  }, [run?.status, setRunning]);

  // Wrap share call to include runId for task methods
  const shareCall = useCallback(async (method: string, params?: Record<string, unknown>) => {
    const runId = run?.id;
    if (method === "task.create" && runId) {
      return call("task.create", { ...params });
    }
    if (method === "task.retry" && runId) {
      return call("task.retry", { taskId: (params as Record<string, unknown>)?.taskId });
    }
    return call(method, params);
  }, [call, run?.id]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full mx-auto mb-4" style={{ borderColor: "var(--blue)", borderTopColor: "transparent" }} />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>加载分享看板...</p>
        </div>
      </div>
    );
  }

  if (error) {
    const isExpired = error.includes("expired") || error.includes("过期");
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: "var(--bg-primary)" }}>
        <div className="text-center max-w-md px-6">
          <div className="text-4xl mb-4" style={{ opacity: 0.3 }}>{isExpired ? "🔒" : ":("}</div>
          <p className="text-sm font-semibold mb-2" style={{ color: isExpired ? "var(--yellow)" : "var(--red)" }}>
            {isExpired ? "此分享链接已过期" : "加载失败"}
          </p>
          <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
            {isExpired ? "请联系分享者获取新的链接" : error}
          </p>
          {!isExpired && (
            <button
              onClick={() => refresh()}
              className="px-4 py-2 rounded-lg text-xs font-semibold"
              style={{ background: "var(--blue)", color: "#fff" }}
            >
              重试
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <EvolutionDashboard
      shareMode
      shareCall={shareCall}
      shareRunId={run?.id}
      shareRun={run}
      wsConnectedOverride={wsConnected}
    />
  );
}
