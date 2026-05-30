/**
 * Agent Role definitions for the role-based collaboration system.
 *
 * Each role encapsulates a system prompt, allowed tools, and max turns,
 * decoupling the orchestration logic from the specifics of each agent.
 */

import {
  buildPlannerSystemPrompt,
  buildDeveloperSystemPrompt,
  buildTesterSystemPrompt,
  buildReviewerSystemPrompt,
} from "../pipeline-prompts.js";

// ─── Core types ─────────────────────────────────────────────────────────────

export interface AgentRole {
  /** Unique identifier, e.g. "planner" */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description of what this role does */
  description: string;
  /** System prompt injected via --append-system-prompt */
  systemPrompt: string;
  /** Tools this agent is allowed to use */
  tools: string[];
  /** Maximum conversation turns for a single execution */
  maxTurns: number;
}

// ─── Built-in roles ─────────────────────────────────────────────────────────

export const PLANNER_ROLE: AgentRole = {
  id: "planner",
  name: "Planner",
  description: "Analyzes tasks and produces concrete, actionable execution plans.",
  systemPrompt: buildPlannerSystemPrompt(),
  tools: ["Read", "Glob", "Grep", "Bash"],
  maxTurns: 15,
};

export const DEVELOPER_ROLE: AgentRole = {
  id: "developer",
  name: "Developer",
  description: "Implements the assigned task with high quality code following the execution plan.",
  systemPrompt: buildDeveloperSystemPrompt(),
  tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  maxTurns: 40,
};

export const TESTER_ROLE: AgentRole = {
  id: "tester",
  name: "Tester",
  description: "Writes tests and verifies that the codebase works correctly.",
  systemPrompt: buildTesterSystemPrompt(),
  tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
  maxTurns: 25,
};

export const REVIEWER_ROLE: AgentRole = {
  id: "reviewer",
  name: "Reviewer",
  description: "Reviews code changes for quality, correctness, and potential issues.",
  systemPrompt: buildReviewerSystemPrompt(),
  tools: ["Read", "Bash", "Glob", "Grep"],
  maxTurns: 20,
};

/**
 * Registry of all built-in roles, keyed by role id.
 */
export const BUILT_IN_ROLES: Readonly<Record<string, AgentRole>> = {
  planner: PLANNER_ROLE,
  developer: DEVELOPER_ROLE,
  tester: TESTER_ROLE,
  reviewer: REVIEWER_ROLE,
};

/**
 * Look up a role by id. Returns `undefined` for unknown roles.
 */
export function getRole(id: string): AgentRole | undefined {
  return BUILT_IN_ROLES[id];
}

// ─── Crew orchestration types ───────────────────────────────────────────────

/**
 * Orchestration mode for the crew.
 *
 * - `sequential`  – all agents run once, in order (planner -> dev -> test -> review)
 * - `fixloop`     – planner once, then dev -> test -> review loop until approved
 * - `parallel`    – planner once, then dev and tester run concurrently
 * - `adaptive`    – (reserved for future use)
 */
export type CrewMode = "sequential" | "fixloop" | "parallel" | "adaptive";

export interface CrewConfig {
  /** Orchestration mode */
  mode: CrewMode;
  /** Ordered list of role ids to include in the crew */
  agents: string[];
  /** Maximum number of fix iterations for fixloop mode */
  maxFixIterations: number;
}

export const DEFAULT_CREW_CONFIG: Readonly<CrewConfig> = {
  mode: "fixloop",
  agents: ["planner", "developer", "tester", "reviewer"],
  maxFixIterations: 3,
};
