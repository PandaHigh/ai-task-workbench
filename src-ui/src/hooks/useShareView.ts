import { useState, useEffect, useCallback, useRef } from "react";
import type { ExecutionRun, TaskDefinition, GitCommit, LessonLearned, GoalStatus, RunStatus } from "@ai-workbench/shared";
import { ShareClient } from "../lib/share-client";

const SAFETY_POLL_INTERVAL = 30_000;

export function useShareView(token: string) {
  const client = useRef(new ShareClient());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [run, setRun] = useState<ExecutionRun | null>(null);
  const [tasks, setTasks] = useState<TaskDefinition[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [lessons, setLessons] = useState<LessonLearned[]>([]);
  const [queue, setQueue] = useState<TaskDefinition[]>([]);
  const [report, setReport] = useState<{ report: string; generatedAt: number } | null>(null);
  const [logs, setLogs] = useState<Array<{ id: number; timestamp: number; level: string; source: string; message: string }>>([]);
  const wsConnectedRef = useRef(false);

  const fullRefresh = useCallback(async () => {
    const c = client.current;
    try {
      const [runData, taskData, commitData, lessonData, queueData, reportData, logsData] = await Promise.allSettled([
        c.getRun(token),
        c.getTasks(token),
        c.getCommits(token),
        c.getLessons(token),
        c.getQueue(token),
        c.getReport(token),
        c.getLogs(token),
      ]);
      if (runData.status === "fulfilled") setRun(runData.value);
      if (taskData.status === "fulfilled") setTasks(taskData.value);
      if (commitData.status === "fulfilled") setCommits(commitData.value);
      if (lessonData.status === "fulfilled") setLessons(lessonData.value);
      if (queueData.status === "fulfilled") setQueue(queueData.value);
      if (reportData.status === "fulfilled") setReport(reportData.value);
      if (logsData.status === "fulfilled") setLogs(logsData.value);
    } catch (err) {
      console.warn("Share full refresh failed:", err);
    }
  }, [token]);

  // Connect WebSocket + load initial data, fallback to HTTP polling
  useEffect(() => {
    setError("");
    setRun(null);
    setTasks([]);
    setCommits([]);
    setLessons([]);
    setQueue([]);
    setReport(null);
    setLogs([]);
    wsConnectedRef.current = false;

    let cancelled = false;
    const c = client.current;

    const load = async () => {
      setLoading(true);
      try {
        // Try WebSocket first
        const initial = await c.connectWebSocket(token);
        if (cancelled) return;
        wsConnectedRef.current = true;
        setRun(initial.run);
        setTasks(initial.tasks || []);
        setQueue(initial.queue || []);

        // Fetch remaining data via HTTP
        const [commitData, lessonData, reportData, logsData] = await Promise.allSettled([
          c.getCommits(token),
          c.getLessons(token),
          c.getReport(token),
          c.getLogs(token),
        ]);
        if (cancelled) return;
        if (commitData.status === "fulfilled") setCommits(commitData.value);
        if (lessonData.status === "fulfilled") setLessons(lessonData.value);
        if (reportData.status === "fulfilled") setReport(reportData.value);
        if (logsData.status === "fulfilled") setLogs(logsData.value);

        setLoading(false);
      } catch (wsErr) {
        // Fallback to HTTP polling
        console.warn("WebSocket connect failed, falling back to polling:", wsErr);
        try {
          const runData = await c.getRun(token);
          if (cancelled) return;
          setRun(runData);
          await fullRefresh();
          if (!cancelled) setLoading(false);
        } catch (httpErr) {
          if (!cancelled) {
            setError(httpErr instanceof Error ? httpErr.message : "Failed to load share");
            setLoading(false);
          }
        }
      }
    };

    load();
    return () => {
      cancelled = true;
      c.disconnectWebSocket();
    };
  }, [token, fullRefresh]);

  // Register notification handler for real-time updates
  useEffect(() => {
    const c = client.current;
    c.onNotification((method, params) => {
      switch (method) {
        case "run.status":
          setRun(prev => prev ? { ...prev, status: params.status as RunStatus, ...(params.finalReport ? { finalReport: params.finalReport as string } : {}) } : prev);
          if (["completed", "failed", "paused", "budget_exceeded"].includes(params.status as string)) {
            c.getRun(token).then(r => setRun(r)).catch(() => {});
          }
          break;
        case "queue.updated":
          setQueue((params.queue as TaskDefinition[]) || []);
          break;
        case "task.status":
        case "task.scored":
          c.getTasks(token).then(setTasks).catch(() => {});
          break;
        case "log.entry":
          setLogs(prev => [...prev, { id: Date.now(), timestamp: Date.now(), ...(params as Record<string, unknown>) } as (typeof prev)[number]]);
          break;
        case "git.commit":
          c.getCommits(token).then(setCommits).catch(() => {});
          break;
        case "goal.updated":
          setRun(prev => prev ? { ...prev, goalStatus: (params as Record<string, unknown>).status as GoalStatus } : prev);
          break;
        case "task.phase":
        case "task.stream":
          // Streaming output — refresh tasks to get latest progress
          c.getTasks(token).then(setTasks).catch(() => {});
          break;
      }
    });
    return () => { c.onNotification(() => {}); };
  }, [token]);

  // Safety net polling (30s) — only when not using WebSocket
  useEffect(() => {
    if (loading || error) return;
    if (wsConnectedRef.current) return;
    const interval = setInterval(fullRefresh, SAFETY_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loading, error, fullRefresh]);

  const call = useCallback(async (method: string, params?: Record<string, unknown>) => {
    const c = client.current;
    switch (method) {
      case "task.create":
        return c.createTask(token, params as { content: string; type?: string; priority?: number; timeoutMinutes?: number });
      case "task.start":
        return c.startTask(token, params!.taskId as string);
      case "task.retry":
        return c.retryTask(token, params!.taskId as string);
      case "run.stop":
        return c.stopRun(token);
      case "queue.reorder":
        return c.reorderQueue(token, (params!.taskIds) as string[]);
      case "task.setTimeout":
        return c.setTaskTimeout(token, params!.taskId as string, params!.minutes as number);
      case "queue.list":
        return { runId: token, queue };
      case "run.tasks":
        return tasks;
      case "run.commits":
        return commits;
      case "run.lessons":
        return lessons;
      case "run.report":
        return { run, report };
      case "run.logs":
        return logs;
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }, [token, queue, tasks, commits, lessons, run, report, logs]);

  return { loading, error, run, tasks, commits, lessons, queue, report, logs, call, refresh: fullRefresh };
}
