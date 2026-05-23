export type TaskStatus =
  | "pending"
  | "running"
  | "scoring"
  | "committing"
  | "reverting"
  | "completed"
  | "reverted"
  | "failed"
  | "cancelled";

export type RunStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "failed";

export type TaskType = "user_defined" | "smart_task";

export type AgentMode = "single" | "multi";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogSource = "cc" | "engine" | "git" | "scorer" | "wizard";

export type LessonCategory = "failure" | "success" | "optimization";

export type RobotMood = "idle" | "thinking" | "working" | "celebrating" | "error";
