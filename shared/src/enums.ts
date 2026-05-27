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

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogSource = "cc" | "engine" | "git" | "scorer" | "wizard";

export type LessonCategory = "failure" | "success" | "optimization";

export type RobotMood = "idle" | "thinking" | "working" | "celebrating" | "error";

export type GoalStatus = "pursuing" | "paused" | "achieved" | "unmet" | "budget_exhausted";
