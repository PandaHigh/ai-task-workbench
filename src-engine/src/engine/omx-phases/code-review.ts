/**
 * Phase 4: Code Review — Architect + Momus dual review
 *
 * Two independent reviews run sequentially:
 * 1. Architect reviews for technical correctness
 * 2. Momus reviews for adversarial risk assessment
 *
 * Both must approve for the gate to pass.
 * If either rejects, the pipeline loops back to RALPLAN.
 */

import type { CCClient } from "../../cc-integration/cc-client.js";
import type { NotifyFn } from "../omx-pipeline.js";
import { routeRoleForPhase } from "../omx-roles.js";
import { extractJson } from "../../lib/json-extract.js";
import type { UltragoalArtifacts } from "./ultragoal.js";
import type { ExecutionPlan, ReviewResult, TaskDefinition } from "@ai-workbench/shared";

export interface CodeReviewArtifacts {
  reviewResult: ReviewResult;
  architectApproved: boolean;
  criticApproved: boolean;
  combinedFeedback: string;
}

export async function runCodeReview(
  task: TaskDefinition,
  plan: ExecutionPlan,
  ultragoalArtifacts: UltragoalArtifacts,
  ccClient: CCClient,
  notify: NotifyFn,
  workingDir: string,
  abortSignal?: AbortSignal,
): Promise<CodeReviewArtifacts> {
  // Architect review
  notify("task.progress", {
    taskId: task.id,
    phase: "code-review",
    message: "Architect reviewing code changes...",
  });

  const { primary: architectRole, secondary: specialistReviewer } = routeRoleForPhase("code-review", task.content);
  const architectPrompt = `## Execution Plan\n${plan.understanding}\nSteps: ${plan.steps.join("; ")}\nTarget Files: ${plan.targetFiles.join(", ")}

## Code Changes\n${ultragoalArtifacts.diffSummary}

## Instructions
Review the code changes for quality, correctness, and potential issues.

1. Check for correctness, edge cases, and error handling
2. Look for security vulnerabilities (OWASP top 10)
3. Verify the code follows project conventions
4. Assess test coverage adequacy
5. Provide specific, actionable feedback

Respond ONLY with valid JSON:
{
  "approved": true_or_false,
  "score": 0.0_to_1.0,
  "issues": [{ "severity": "critical"|"major"|"minor", "file": "path", "line": 123, "description": "what's wrong", "suggestion": "how to fix" }],
  "summary": "brief review summary"
}`;

  const architectResult = await ccClient.executeTask(architectPrompt, {
    workingDir,
    timeoutMinutes: 10,
    maxTurns: architectRole.maxTurns,
    systemPrompt: "You are a senior code reviewer. Assess technical correctness, security, and code quality. Respond with valid JSON only.",
    abortSignal,
  });

  let architectReview: ReviewResult;
  try {
    architectReview = JSON.parse(extractJson(architectResult.result));
  } catch {
    architectReview = { approved: false, score: 0.3, issues: [], summary: "Failed to parse architect review" };
  }

  // Momus (critic) review
  notify("task.progress", {
    taskId: task.id,
    phase: "code-review",
    message: "Momus conducting adversarial review...",
  });

  const momusRole = specialistReviewer ?? { maxTurns: 15, tools: ["Read", "Glob", "Grep", "Bash"] };
  const momusPrompt = `## Execution Plan\n${plan.understanding}

## Code Changes\n${ultragoalArtifacts.diffSummary}

## Architect Review
${architectReview.summary}
${architectReview.issues.map((i) => `- [${i.severity}] ${i.description}`).join("\n")}

## Instructions
You are an adversarial critic. Find EVERY possible flaw in these changes:
1. What could go wrong in production?
2. What edge cases are missed?
3. What are the security/performance risks?
4. Is the code overengineered or underengineered?

Be thorough. Only approve if genuinely solid.

Respond ONLY with valid JSON:
{
  "approved": true_or_false,
  "score": 0.0_to_1.0,
  "issues": [{ "severity": "critical"|"major"|"minor", "file": "path", "line": 123, "description": "what's wrong", "suggestion": "how to fix" }],
  "summary": "adversarial assessment"
}`;

  const momusResult = await ccClient.executeTask(momusPrompt, {
    workingDir,
    timeoutMinutes: 10,
    maxTurns: momusRole.maxTurns,
    systemPrompt: "You are an adversarial code reviewer. Find every possible flaw. Only approve genuinely solid code. Respond with valid JSON only.",
    abortSignal,
  });

  let criticReview: ReviewResult;
  try {
    criticReview = JSON.parse(extractJson(momusResult.result));
  } catch {
    criticReview = { approved: false, score: 0.3, issues: [], summary: "Failed to parse critic review" };
  }

  // Combine results
  const combinedApproved = architectReview.approved && criticReview.approved;
  const combinedScore = (architectReview.score + criticReview.score) / 2;
  const allIssues = [...architectReview.issues, ...criticReview.issues];
  const combinedFeedback = buildCombinedFeedback(architectReview, criticReview);

  const reviewResult: ReviewResult = {
    approved: combinedApproved,
    score: combinedScore,
    issues: allIssues,
    summary: `[Architect] ${architectReview.summary}\n[Critic] ${criticReview.summary}`,
  };

  notify("task.progress", {
    taskId: task.id,
    phase: "code-review",
    message: combinedApproved
      ? `Review passed (score: ${combinedScore.toFixed(2)})`
      : `Review failed (score: ${combinedScore.toFixed(2)}), looping back to RALPLAN`,
  });

  return {
    reviewResult,
    architectApproved: architectReview.approved,
    criticApproved: criticReview.approved,
    combinedFeedback,
  };
}

function buildCombinedFeedback(architect: ReviewResult, critic: ReviewResult): string {
  const parts: string[] = [];
  parts.push(`### Architect Feedback:\n${architect.summary}`);
  parts.push(`### Critic Feedback:\n${critic.summary}`);

  const criticalIssues = [...architect.issues, ...critic.issues].filter((i) => i.severity === "critical");
  const majorIssues = [...architect.issues, ...critic.issues].filter((i) => i.severity === "major");

  if (criticalIssues.length > 0) {
    parts.push(`### Critical Issues:\n${criticalIssues.map((i) => `- [${i.file}${i.line ? `:${i.line}` : ""}] ${i.description}\n  Fix: ${i.suggestion}`).join("\n")}`);
  }
  if (majorIssues.length > 0) {
    parts.push(`### Major Issues:\n${majorIssues.map((i) => `- [${i.file}${i.line ? `:${i.line}` : ""}] ${i.description}\n  Fix: ${i.suggestion}`).join("\n")}`);
  }

  return parts.join("\n\n");
}
