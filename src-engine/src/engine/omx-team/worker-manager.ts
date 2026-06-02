/**
 * Worker Manager — manages Node.js child processes for Team parallel execution.
 *
 * Each worker runs in its own process with an isolated git worktree.
 * Workers communicate via IPC (stdin/stdout JSON messages).
 */

import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import { writeFileSync } from "fs";
import type { WorkerConfig, WorkerMessage, WorkerTaskAssignment, WorkerTaskResult } from "./worker-protocol.js";
import type { NotifyFn } from "../omx-pipeline.js";

const WORKER_SCRIPT = `
const { spawn } = require("child_process");
const { join } = require("path");

let currentTask = null;

process.stdin.setEncoding("utf-8");
let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      handleMessage(msg);
    } catch (e) {
      // ignore parse errors
    }
  }
});

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\\n");
}

async function handleMessage(msg) {
  if (msg.type === "dispatch") {
    currentTask = msg.payload;
    send({ type: "heartbeat", workerId: msg.workerId, timestamp: Date.now() });
    try {
      const result = await executeTask(msg.payload);
      send({ type: "result", workerId: msg.workerId, taskId: msg.payload.taskId, payload: result, timestamp: Date.now() });
    } catch (err) {
      send({ type: "error", workerId: msg.workerId, taskId: msg.payload?.taskId, payload: { message: err.message }, timestamp: Date.now() });
    }
  } else if (msg.type === "heartbeat") {
    send({ type: "heartbeat", workerId: msg.workerId, timestamp: Date.now() });
  }
}

async function executeTask(assignment) {
  const args = [
    "-p", assignment.content,
    "--output-format", "text",
    "--verbose",
    "--permission-mode", "acceptEdits",
    "--max-turns", "30",
  ];
  if (assignment.model) args.push("--model", assignment.model);

  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      cwd: assignment.workingDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let lineBuffer = "";
    proc.stdout.on("data", (d) => {
      const text = d.toString();
      stdout += text;
      // Forward output lines as progress messages
      lineBuffer += text;
      const lines = lineBuffer.split("\\n");
      lineBuffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          send({ type: "progress", workerId: process.env.WORKER_ID, taskId: assignment.taskId, payload: { line }, timestamp: Date.now() });
        }
      }
    });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    const timeoutMs = (assignment.timeoutMinutes || 10) * 60 * 1000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch(e) {} }, 5000);
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      // Flush remaining buffer
      if (lineBuffer.trim()) {
        send({ type: "progress", workerId: process.env.WORKER_ID, taskId: assignment.taskId, payload: { line: lineBuffer }, timestamp: Date.now() });
      }
      if (timedOut) {
        reject(new Error("Task timed out after " + (timeoutMs / 1000) + "s"));
      } else if (code === 0) {
        resolve({ success: true, output: stdout, durationMs: 0, costUsd: 0 });
      } else {
        reject(new Error(stderr || "Process exited with code " + code));
      }
    });
    proc.on("error", reject);
  });
}

send({ type: "ready", workerId: process.env.WORKER_ID || "unknown", timestamp: Date.now() });
`;

export class OmxAmpWorkerManager {
  private workers = new Map<string, ChildProcess>();
  private results = new Map<string, WorkerTaskResult>();
  private pending = new Map<string, { resolve: (result: WorkerTaskResult) => void; reject: (err: Error) => void }>();

  constructor(
    private notify: NotifyFn,
    _workerCount: number = 2,
  ) {
    void _workerCount;
  }

  async spawn(configs: WorkerConfig[]): Promise<void> {
    // Write worker script to temp file
    const scriptPath = join(configs[0]?.workingDir ?? process.cwd(), ".omx-worker-script.js");
    writeFileSync(scriptPath, WORKER_SCRIPT);

    for (const config of configs) {
      const proc = spawn("node", [scriptPath], {
        cwd: config.workingDir,
        env: {
          ...process.env,
          WORKER_ID: config.workerId,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let buffer = "";
      proc.stdout!.setEncoding("utf-8");
      proc.stdout!.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as WorkerMessage;
            this.handleWorkerMessage(msg);
          } catch { /* ignore */ }
        }
      });

      this.workers.set(config.workerId, proc);
      this.notify("log.entry", {
        level: "info",
        source: "engine",
        message: `[team] Worker ${config.workerId} spawned`,
      });
    }
  }

  async dispatch(workerId: string, assignment: WorkerTaskAssignment): Promise<WorkerTaskResult> {
    const proc = this.workers.get(workerId);
    if (!proc) throw new Error(`Worker ${workerId} not found`);

    return new Promise((resolve, reject) => {
      this.pending.set(assignment.taskId, { resolve, reject });
      const msg: WorkerMessage = {
        type: "dispatch",
        workerId,
        taskId: assignment.taskId,
        payload: assignment,
        timestamp: Date.now(),
      };
      proc.stdin!.write(JSON.stringify(msg) + "\n");
    });
  }

  private handleWorkerMessage(msg: WorkerMessage): void {
    if (msg.type === "result" && msg.taskId) {
      const pending = this.pending.get(msg.taskId);
      if (pending) {
        this.pending.delete(msg.taskId);
        const result = msg.payload as WorkerTaskResult;
        this.results.set(msg.taskId, result);
        pending.resolve(result);
      }
    } else if (msg.type === "error" && msg.taskId) {
      const pending = this.pending.get(msg.taskId);
      if (pending) {
        this.pending.delete(msg.taskId);
        pending.reject(new Error((msg.payload as { message: string })?.message ?? "Worker error"));
      }
    } else if (msg.type === "progress" && msg.taskId) {
      const payload = msg.payload as { line?: string };
      if (payload?.line) {
        this.notify("log.entry", {
          level: "info",
          source: "cc",
          message: `[worker-${msg.workerId}] ${payload.line}`,
          taskId: msg.taskId,
        });
      }
    }
  }

  getAvailableWorkers(): string[] {
    return [...this.workers.keys()].filter((id) => {
      const proc = this.workers.get(id);
      return proc && !proc.killed;
    });
  }

  getResult(taskId: string): WorkerTaskResult | undefined {
    return this.results.get(taskId);
  }

  async terminate(): Promise<void> {
    for (const [_id, proc] of this.workers) {
      try {
        proc.kill("SIGTERM");
        setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* already dead */ } }, 5000);
      } catch { /* already dead */ }
    }
    this.workers.clear();
    this.pending.clear();
  }
}
