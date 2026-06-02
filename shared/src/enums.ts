export type TaskStatus =
  | "pending"
  | "running"
  | "scoring"
  | "committing"
  | "reverting"
  | "completed"
  | "reverted"
  | "failed"
  | "cancelled"
  | "paused"
  | "skipped";

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

// ─── Approval system ─────────────────────────────────────────────────────

export type CheckpointType =
  | "risky_commit"       // commit 影响范围大，需要人类 review
  | "borderline_score"   // 评分接近阈值，AI 拿不准
  | "goal_stagnation";   // 进度停滞，AI 遇到瓶颈

export type ApprovalStatus = "pending" | "approved" | "rejected" | "modified" | "timed_out";

// ─── Pipeline phases ──────────────────────────────────────────────────

export type TaskPhase =
  | "planner" | "developer" | "tester" | "reviewer"
  | "deep-interview" | "ralplan" | "ultragoal" | "code-review" | "ultraqa";

// ─── Multi-user collaboration ──────────────────────────────────────────

export type UserRole = "owner" | "collaborator" | "viewer";

export type AutonomyLevel = "supervised" | "assisted" | "autonomous";
