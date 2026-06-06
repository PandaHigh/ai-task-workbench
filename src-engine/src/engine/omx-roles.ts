/**
 * OMX-style agent role system adapted for Claude CLI.
 *
 * Each role is described by 5 dimensions:
 * - posture: behavioral orientation
 * - modelClass: maps to Claude model tier (frontier=opus, standard=sonnet, fast=haiku)
 * - routingRole: coordinator / worker / reviewer / specialist
 * - tools: allowed CC tool set
 * - category: functional grouping
 */

import type { TaskContext } from "@ai-workbench/shared";

// ─── Core types ─────────────────────────────────────────────────────────────

export type ModelClass = "frontier" | "standard" | "fast";
export type AgentPosture = "analytical" | "creative" | "critical" | "constructive" | "inquisitive" | "adversarial";
export type RoutingRole = "coordinator" | "worker" | "reviewer" | "specialist";
export type AgentCategory = "planning" | "execution" | "review" | "research" | "meta";

export interface OmxAmpRole {
  id: string;
  name: string;
  description: string;
  posture: AgentPosture;
  modelClass: ModelClass;
  routingRole: RoutingRole;
  tools: string[];
  maxTurns: number;
  category: AgentCategory;
}

export const MODEL_CLASS_MAP: Record<ModelClass, string> = {
  frontier: "claude-opus-4-7",
  standard: "claude-sonnet-4-6",
  fast: "claude-haiku-4-5",
};

// ─── Role definitions ───────────────────────────────────────────────────────

const ROLES: OmxAmpRole[] = [
  // ── Build lane ──
  {
    id: "explore",
    name: "Explorer",
    description: "Discovers project structure, dependencies, and conventions.",
    posture: "analytical",
    modelClass: "fast",
    routingRole: "specialist",
    tools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 10,
    category: "research",
  },
  {
    id: "analyst",
    name: "Analyst",
    description: "Analyzes requirements, maps dependencies, identifies risks.",
    posture: "analytical",
    modelClass: "standard",
    routingRole: "coordinator",
    tools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 15,
    category: "planning",
  },
  {
    id: "planner",
    name: "Planner",
    description: "Creates concrete execution plans from task descriptions.",
    posture: "constructive",
    modelClass: "standard",
    routingRole: "coordinator",
    tools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 15,
    category: "planning",
  },
  {
    id: "architect",
    name: "Architect",
    description: "Reviews technical designs, validates architecture decisions.",
    posture: "analytical",
    modelClass: "frontier",
    routingRole: "reviewer",
    tools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 15,
    category: "planning",
  },
  {
    id: "debugger",
    name: "Debugger",
    description: "Diagnoses and fixes bugs through systematic investigation.",
    posture: "analytical",
    modelClass: "standard",
    routingRole: "specialist",
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    maxTurns: 25,
    category: "execution",
  },
  {
    id: "executor",
    name: "Executor",
    description: "Implements code changes following execution plans.",
    posture: "constructive",
    modelClass: "standard",
    routingRole: "worker",
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    maxTurns: 40,
    category: "execution",
  },
  {
    id: "verifier",
    name: "Verifier",
    description: "Verifies implementation correctness against specifications.",
    posture: "analytical",
    modelClass: "standard",
    routingRole: "reviewer",
    tools: ["Read", "Bash", "Glob", "Grep"],
    maxTurns: 20,
    category: "review",
  },

  // ── Review lane ──
  {
    id: "quality-reviewer",
    name: "Quality Reviewer",
    description: "Reviews code quality, patterns, and maintainability.",
    posture: "critical",
    modelClass: "standard",
    routingRole: "reviewer",
    tools: ["Read", "Bash", "Glob", "Grep"],
    maxTurns: 15,
    category: "review",
  },
  {
    id: "security-reviewer",
    name: "Security Reviewer",
    description: "Reviews for security vulnerabilities and compliance.",
    posture: "adversarial",
    modelClass: "standard",
    routingRole: "reviewer",
    tools: ["Read", "Bash", "Glob", "Grep"],
    maxTurns: 15,
    category: "review",
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description: "General code review for correctness and completeness.",
    posture: "critical",
    modelClass: "standard",
    routingRole: "reviewer",
    tools: ["Read", "Bash", "Glob", "Grep"],
    maxTurns: 20,
    category: "review",
  },

  // ── Domain lane ──
  {
    id: "test-engineer",
    name: "Test Engineer",
    description: "Designs and implements test strategies and test suites.",
    posture: "constructive",
    modelClass: "standard",
    routingRole: "specialist",
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    maxTurns: 25,
    category: "execution",
  },
  {
    id: "designer",
    name: "Designer",
    description: "Implements UI/UX changes following design specifications.",
    posture: "creative",
    modelClass: "standard",
    routingRole: "specialist",
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    maxTurns: 30,
    category: "execution",
  },
  {
    id: "qa-tester",
    name: "QA Tester",
    description: "End-to-end testing and user-facing quality assurance.",
    posture: "adversarial",
    modelClass: "standard",
    routingRole: "reviewer",
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    maxTurns: 25,
    category: "review",
  },
  {
    id: "git-master",
    name: "Git Master",
    description: "Manages git operations, branches, merges, and conflict resolution.",
    posture: "analytical",
    modelClass: "standard",
    routingRole: "specialist",
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    maxTurns: 15,
    category: "execution",
  },
  {
    id: "code-simplifier",
    name: "Code Simplifier",
    description: "Simplifies and refactors code for clarity and maintainability.",
    posture: "analytical",
    modelClass: "standard",
    routingRole: "specialist",
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    maxTurns: 20,
    category: "execution",
  },
  {
    id: "researcher",
    name: "Researcher",
    description: "Investigates technologies, libraries, and best practices.",
    posture: "inquisitive",
    modelClass: "standard",
    routingRole: "specialist",
    tools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 15,
    category: "research",
  },

  // ── Product lane (used by team orchestrator) ──
  {
    id: "product-manager",
    name: "Product Manager",
    description: "Translates user needs into actionable requirements and priorities.",
    posture: "inquisitive",
    modelClass: "standard",
    routingRole: "coordinator",
    tools: ["Read", "Glob", "Grep"],
    maxTurns: 15,
    category: "planning",
  },

  // ── Coordination lane (Prometheus) ──
  {
    id: "metis",
    name: "Prometheus Metis",
    description: "Interview agent — clarifies requirements through deep questioning.",
    posture: "inquisitive",
    modelClass: "standard",
    routingRole: "coordinator",
    tools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 20,
    category: "meta",
  },
  {
    id: "momus",
    name: "Prometheus Momus",
    description: "Critic agent — adversarial plan review and risk challenge.",
    posture: "adversarial",
    modelClass: "standard",
    routingRole: "reviewer",
    tools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 15,
    category: "meta",
  },
  {
    id: "oracle",
    name: "Prometheus Oracle",
    description: "Validation agent — verifies implementation readiness and completion.",
    posture: "analytical",
    modelClass: "frontier",
    routingRole: "reviewer",
    tools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 15,
    category: "meta",
  },
];

export const OMX_ROLES: Readonly<Record<string, OmxAmpRole>> = Object.fromEntries(ROLES.map((r) => [r.id, r]));

export function getOmxRole(id: string): OmxAmpRole | undefined {
  return OMX_ROLES[id];
}

export function getRolesByCategory(category: AgentCategory): OmxAmpRole[] {
  return ROLES.filter((r) => r.category === category);
}

export function getRolesByRoutingRole(routingRole: RoutingRole): OmxAmpRole[] {
  return ROLES.filter((r) => r.routingRole === routingRole);
}

// ─── Role routing based on task content ──────────────────────────────────────

// Priority chain: roles ordered by specificity — first match wins on tie.
// Each entry: [roleId, keywords, regexPatterns, weight]
// weight boosts the role's score when keywords match (higher = more specific)
const ROLE_KEYWORDS: Array<{
  id: string;
  keywords: string[];
  patterns: RegExp[];
  weight: number;
}> = [
  // ── High-specificity specialists (weight 3) ──
  {
    id: "security-reviewer",
    keywords: ["security", "vulnerability", "xss", "csrf", "injection", "安全", "漏洞"],
    patterns: [/\b(auth|jwt|token|encrypt|ssl|tls|oauth)\b/i],
    weight: 3,
  },
  {
    id: "qa-tester",
    keywords: ["e2e", "integration test", "acceptance", "smoke", "回归"],
    patterns: [/\b(playwright|cypress|selenium|puppeteer)\b/i],
    weight: 3,
  },
  {
    id: "researcher",
    keywords: ["research", "investigate", "compare", "evaluate", "调研", "分析"],
    patterns: [/\b(benchmark|hypothesis|ablation|study)\b/i],
    weight: 3,
  },

  // ── Medium-specificity (weight 2) ──
  {
    id: "designer",
    keywords: ["ui", "ux", "css", "style", "layout", "component", "frontend", "界面", "样式", "组件", "页面"],
    patterns: [/\b(design|figma|tailwind|styled|animation)\b/i],
    weight: 2,
  },
  {
    id: "debugger",
    keywords: ["bug", "fix", "error", "crash", "debug", "broken", "fail", "异常", "修复", "崩溃"],
    patterns: [/\b(stack\s*trace|segfault|assertion|panic)\b/i],
    weight: 2,
  },
  {
    id: "code-simplifier",
    keywords: ["refactor", "simplify", "clean", "restructure", "重构", "简化"],
    patterns: [/\b(dedup|extract|rename|move|dead\s*code)\b/i],
    weight: 2,
  },
  {
    id: "test-engineer",
    keywords: ["test", "spec", "jest", "vitest", "单元测试"],
    patterns: [/\b(unit\s*test|coverage|mock|stub|snapshot)\b/i],
    weight: 2,
  },
  {
    id: "git-master",
    keywords: ["git", "merge", "branch", "conflict", "rebase", "版本", "分支"],
    patterns: [/\b(cherry.pick|bisect|stash|blame)\b/i],
    weight: 2,
  },

  // ── Broad catch-alls (weight 1) ──
  {
    id: "product-manager",
    keywords: ["requirement", "feature", "user story", "需求", "功能"],
    patterns: [/\b(backlog|sprint|epic|acceptance)\b/i],
    weight: 1,
  },
];

/**
 * OMX-style role routing: keyword matching + regex scoring + weight priority.
 * Three layers:
 *   Layer 1: keyword match → score * weight
 *   Layer 2: regex pattern match → flat bonus
 *   Layer 3: fallback by task category heuristics
 */
export function routeRoleForPhase(
  phase: "deep-interview" | "ralplan" | "ultragoal" | "code-review" | "ultraqa",
  taskContent: string,
): { primary: OmxAmpRole; secondary?: OmxAmpRole } {
  const content = taskContent.toLowerCase();

  switch (phase) {
    case "deep-interview":
      return { primary: getOmxRole("metis")! };

    case "ralplan":
      return {
        primary: getOmxRole("planner")!,
        secondary: content.includes("architect") || content.includes("架构") ? getOmxRole("architect")! : undefined,
      };

    case "ultragoal":
      return routeByContent(content);

    case "code-review":
      return routeReviewer(content);

    case "ultraqa":
      return routeQa(content);

    default:
      return { primary: getOmxRole("executor")! };
  }
}

/** Layer 1+2: weighted keyword + regex scoring */
function routeByContent(content: string): { primary: OmxAmpRole; secondary?: OmxAmpRole } {
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const entry of ROLE_KEYWORDS) {
    const kwHits = entry.keywords.filter((kw) => content.includes(kw)).length;
    const regexHits = entry.patterns.filter((p) => p.test(content)).length;
    const score = kwHits * entry.weight + regexHits * entry.weight * 2;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry.id;
    }
  }

  // Layer 3: category heuristics when no strong match
  if (!bestMatch || bestScore < 2) {
    if (/\b(implement|create|add|build|feature)\b/i.test(content)) bestMatch = "executor";
    else if (/\b(analyze|understand|explain|review)\b/i.test(content)) bestMatch = "analyst";
    else if (!bestMatch) bestMatch = "executor";
  }

  return { primary: getOmxRole(bestMatch)! };
}

/** Specialist secondary reviewer based on content domain */
function routeReviewer(content: string): { primary: OmxAmpRole; secondary: OmxAmpRole } {
  const architect = getOmxRole("architect")!;
  for (const entry of ROLE_KEYWORDS) {
    if (!entry.id.includes("reviewer")) continue;
    const kwHits = entry.keywords.filter((kw) => content.includes(kw)).length;
    const regexHits = entry.patterns.filter((p) => p.test(content)).length;
    if (kwHits > 0 || regexHits > 0) {
      const specialist = getOmxRole(entry.id);
      if (specialist) return { primary: architect, secondary: specialist };
    }
  }
  return { primary: architect, secondary: getOmxRole("momus")! };
}

/** Route QA to test-engineer or qa-tester */
function routeQa(content: string): { primary: OmxAmpRole } {
  const qaEntry = ROLE_KEYWORDS.find((e) => e.id === "qa-tester");
  if (qaEntry) {
    const kwHits = qaEntry.keywords.filter((kw) => content.includes(kw)).length;
    const regexHits = qaEntry.patterns.filter((p) => p.test(content)).length;
    if (kwHits > 0 || regexHits > 0) return { primary: getOmxRole("qa-tester")! };
  }
  return { primary: getOmxRole("test-engineer")! };
}

export function getTeamPhaseAgents(phase: string): OmxAmpRole[] {
  const map: Record<string, string[]> = {
    "team-plan": ["analyst", "planner"],
    "team-prd": ["product-manager", "analyst"],
    "team-exec": ["executor", "designer", "test-engineer"],
    "team-verify": ["verifier", "code-reviewer", "quality-reviewer"],
    "team-fix": ["executor", "debugger", "test-engineer"],
  };
  return (map[phase] ?? []).map((id) => OMX_ROLES[id]).filter(Boolean);
}

// ─── Legacy compatibility ───────────────────────────────────────────────────

export interface LegacyAgentRole {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  maxTurns: number;
}

/** @deprecated Use OmxAmpRole instead */
export type AgentRole = LegacyAgentRole;

const LEGACY_ROLE_MAP: Record<string, () => AgentRole> = {
  planner: () => ({
    id: "planner",
    name: "Planner",
    description: "Analyzes tasks and produces execution plans.",
    systemPrompt:
      "You are a Planner. Analyze the task, understand the project context, and produce a concrete execution plan with clear steps.",
    tools: ["Read", "Glob", "Grep", "Bash"],
    maxTurns: 15,
  }),
  developer: () => ({
    id: "developer",
    name: "Developer",
    description: "Implements code changes.",
    systemPrompt:
      "You are a Developer. Implement the code changes described in the execution plan. Write clean, correct, well-tested code.",
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    maxTurns: 40,
  }),
  tester: () => ({
    id: "tester",
    name: "Tester",
    description: "Writes and runs tests.",
    systemPrompt:
      "You are a Tester. Write and run tests to verify the implementation. Cover edge cases and ensure correctness.",
    tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
    maxTurns: 25,
  }),
  reviewer: () => ({
    id: "reviewer",
    name: "Reviewer",
    description: "Reviews code quality.",
    systemPrompt:
      "You are a Code Reviewer. Review the changes for correctness, quality, security, and maintainability.",
    tools: ["Read", "Bash", "Glob", "Grep"],
    maxTurns: 20,
  }),
};

export function omxRoleToLegacy(role: OmxAmpRole): AgentRole {
  const factory = LEGACY_ROLE_MAP[role.id];
  if (factory) return factory();
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    systemPrompt: `You are a ${role.name}. ${role.description}`,
    tools: role.tools,
    maxTurns: role.maxTurns,
  };
}

// ─── Prompt builders ────────────────────────────────────────────────────────

export function buildInterviewPrompt(taskContent: string, context: TaskContext): string {
  return `You are conducting a deep interview to clarify the following task before implementation.

## Task
${taskContent}

## Project Goals
${context.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}

${
  context.lessonsLearned.length > 0
    ? `## Lessons from Previous Failures\n${context.lessonsLearned
        .slice(-5)
        .map((l) => `- [${l.category}] ${l.lesson}`)
        .join("\n")}`
    : ""
}

## Instructions
Analyze this task and identify:
1. Ambiguities that need clarification
2. Edge cases and error scenarios
3. Dependencies on other components
4. Performance or security considerations
5. Acceptance criteria

If the task is already clear and specific, respond with a concise summary confirming your understanding.
If there are ambiguities, list them as focused questions.

Respond ONLY with valid JSON:
{
  "clarifiedDescription": "refined task description incorporating all clarifications",
  "constraints": ["constraint 1", ...],
  "edgeCases": ["edge case 1", ...],
  "acceptanceCriteria": ["criterion 1", ...],
  "questions": ["question 1", ...],
  "isClear": true_or_false
}`;
}

export function buildInterviewSystemPrompt(): string {
  return "You are a senior requirements analyst. Your job is to deeply understand tasks before they are implemented. Identify ambiguities, risks, and missing information. When the task is clear, confirm your understanding concisely.";
}

export function buildRalplanDraftPrompt(taskContent: string, interviewArtifacts: Record<string, unknown>): string {
  const clarDesc = (interviewArtifacts as { clarifiedDescription?: string })?.clarifiedDescription ?? taskContent;
  const constraints = (interviewArtifacts as { constraints?: string[] })?.constraints ?? [];
  const edgeCases = (interviewArtifacts as { edgeCases?: string[] })?.edgeCases ?? [];

  return `Create a detailed execution plan for the following task.

## Task
${clarDesc}

${constraints.length > 0 ? `## Constraints\n${constraints.map((c: string) => `- ${c}`).join("\n")}` : ""}
${edgeCases.length > 0 ? `## Edge Cases\n${edgeCases.map((e: string) => `- ${e}`).join("\n")}` : ""}

## Instructions
1. Read the project files to understand the codebase structure
2. Identify exactly which files need to be created or modified
3. Break the task into 3-8 concrete implementation steps
4. Identify risks and mitigation strategies
5. Define a testing strategy

Respond ONLY with valid JSON:
{
  "understanding": "your understanding of the task",
  "steps": ["step 1", "step 2", ...],
  "targetFiles": ["path/to/file1.ts", ...],
  "risks": ["risk 1", ...],
  "testStrategy": "how to test this change"
}`;
}

export function buildRalplanSystemPrompt(): string {
  return "You are a software architect creating execution plans. You must respond with valid JSON only. Be thorough in your analysis and specific in your steps.";
}

export function buildArchitectReviewPrompt(plan: Record<string, unknown>): string {
  return `Review the following execution plan for technical correctness and feasibility.

## Plan
${JSON.stringify(plan, null, 2)}

## Instructions
Review this plan as a senior architect:
1. Are the steps complete and correct?
2. Are the target files accurate?
3. Are all risks identified?
4. Is the test strategy adequate?
5. Are there any architectural concerns?

Respond ONLY with valid JSON:
{
  "approved": true_or_false,
  "score": 0.0_to_1.0,
  "issues": [{ "severity": "critical"|"major"|"minor", "description": "what's wrong", "suggestion": "how to fix" }],
  "summary": "brief review"
}`;
}

export function buildArchitectReviewSystemPrompt(): string {
  return "You are a senior software architect reviewing execution plans. Assess technical feasibility, completeness, and correctness. Respond with valid JSON only.";
}

export function buildMomusReviewPrompt(plan: Record<string, unknown>): string {
  return `You are an adversarial critic. Challenge this execution plan aggressively.

## Plan
${JSON.stringify(plan, null, 2)}

## Instructions
Your job is to find EVERY possible flaw:
1. What could go wrong that the plan doesn't account for?
2. What assumptions might be incorrect?
3. What edge cases are missed?
4. What are the security/performance risks?
5. Is the plan overengineered or underengineered?

Be constructive but thorough. Only approve if genuinely solid.

Respond ONLY with valid JSON:
{
  "approved": true_or_false,
  "score": 0.0_to_1.0,
  "challenges": [{ "area": "what area", "risk": "what could go wrong", "mitigation": "suggested fix" }],
  "summary": "adversarial assessment"
}`;
}

export function buildMomusReviewSystemPrompt(): string {
  return "You are an adversarial code reviewer whose job is to find flaws in plans. Be thorough and constructively critical. Only approve plans that are genuinely robust. Respond with valid JSON only.";
}
