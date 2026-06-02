/**
 * Worker IPC protocol definitions for Team multi-agent parallel execution.
 */

export type WorkerMessageType = "claim" | "dispatch" | "result" | "mbox" | "error" | "heartbeat" | "ready";

export interface WorkerMessage {
  type: WorkerMessageType;
  workerId: string;
  taskId?: string;
  payload?: unknown;
  timestamp: number;
}

export interface WorkerTaskAssignment {
  taskId: string;
  content: string;
  workingDir: string;
  branchName?: string;
  timeoutMinutes?: number;
  model?: string;
}

export interface WorkerTaskResult {
  taskId: string;
  workerId: string;
  success: boolean;
  output: string;
  score?: number;
  durationMs: number;
  costUsd: number;
  errorMessage?: string;
}

export interface WorkerConfig {
  workerId: string;
  workingDir: string;
  branchName?: string;
  modelClass?: "frontier" | "standard" | "fast";
}
