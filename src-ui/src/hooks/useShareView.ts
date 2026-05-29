import { useState, useEffect, useCallback, useRef } from "react";
import type { ExecutionRun, TaskDefinition, GitCommit, LessonLearned } from "@ai-workbench/shared";
import { ShareClient } from "../lib/share-client";

const POLL_INTERVAL = 5000;
const FULL_REFRESH_INTERVAL = 30_000;

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
  const prevStatusRef = useRef<string | null>(null);
  const lastFullRefreshRef = useRef(0);

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

      if (runData.status === "fulfilled") {
        setRun(runData.value);
        const prevStatus = prevStatusRef.current;
        prevStatusRef.current = runData.value.status;
        if (prevStatus && prevStatus !== runData.value.status) {
          lastFullRefreshRef.current = 0;
        }
      }
      if (taskData.status === "fulfilled") setTasks(taskData.value);
      if (commitData.status === "fulfilled") setCommits(commitData.value);
      if (lessonData.status === "fulfilled") setLessons(lessonData.value);
      if (queueData.status === "fulfilled") setQueue(queueData.value);
      if (reportData.status === "fulfilled") setReport(reportData.value);
      if (logsData.status === "fulfilled") setLogs(logsData.value);
      lastFullRefreshRef.current = Date.now();
    } catch (err) {
      console.warn("Share full refresh failed:", err);
    }
  }, [token]);

  const lightRefresh = useCallback(async () => {
    const c = client.current;
    try {
      const runData = await c.getRun(token);
      setRun(runData);
      const prevStatus = prevStatusRef.current;
      prevStatusRef.current = runData.status;
      if (prevStatus && prevStatus !== runData.status) {
        await fullRefresh();
        return;
      }
      const now = Date.now();
      if (now - lastFullRefreshRef.current >= FULL_REFRESH_INTERVAL) {
        await fullRefresh();
      }
    } catch (err) {
      console.warn("Share light refresh failed:", err);
    }
  }, [token, fullRefresh]);

  // Reset all state and reload when token changes
  useEffect(() => {
    setError("");
    setRun(null);
    setTasks([]);
    setCommits([]);
    setLessons([]);
    setQueue([]);
    setReport(null);
    setLogs([]);
    prevStatusRef.current = null;
    lastFullRefreshRef.current = 0;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const runData = await client.current.getRun(token);
        if (cancelled) return;
        setRun(runData);
        prevStatusRef.current = runData.status;
        await fullRefresh();
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load share");
          setLoading(false);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [token, fullRefresh]);

  useEffect(() => {
    if (loading || error) return;
    const interval = setInterval(lightRefresh, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loading, error, lightRefresh]);

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
