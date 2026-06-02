/**
 * Phase 3: Ultragoal — Goal-oriented code execution
 *
 * Implements code changes following the RALPLAN execution plan.
 * Uses the developer role with the plan as guidance.
 */

import type { CCClient } from "../../cc-integration/cc-client.js";
import type { NotifyFn } from "../omx-pipeline.js";
import { routeRoleForPhase } from "../omx-roles.js";
import type { RalplanArtifacts } from "./ralplan.js";
import type { ExecutionPlan, TaskDefinition } from "@ai-workbench/shared";

export interface UltragoalArtifacts {
  developerOutput: string;
  diffSummary: string;
  plan: ExecutionPlan;
}

export async function runUltragoal(
  task: TaskDefinition,
  context: { goals: string[]; lessonsLearned: { category: string; lesson: string }[] },
  ralplanArtifacts: RalplanArtifacts,
  ccClient: CCClient,
  notify: NotifyFn,
  workingDir: string,
  feedbackFromReview?: string,
  abortSignal?: AbortSignal,
): Promise<UltragoalArtifacts> {
  const { primary: role } = routeRoleForPhase("ultragoal", task.content);
  const plan = ralplanArtifacts.plan;

  const parts: string[] = [];
  parts.push(`## Task\n${task.content}`);
  parts.push(`## Execution Plan
Understanding: ${plan.understanding}
Steps:
${plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}
Target Files: ${plan.targetFiles.join(", ")}
Risks: ${plan.risks.join("; ")}`);

  if (feedbackFromReview) {
    parts.push(`## Previous Attempt Feedback\n${feedbackFromReview}\n\nIMPORTANT: Address ALL the issues above.`);
  }

  if (context.lessonsLearned.length > 0) {
    parts.push(`## Lessons Learned\n${context.lessonsLearned.slice(-5).map((l) => `- [${l.category}] ${l.lesson}`).join("\n")}`);
  }

  parts.push("## Instructions\nImplement the task following the execution plan. Make focused, minimal changes. Follow the project's existing code patterns.");

  notify("task.progress", {
    taskId: task.id,
    phase: "ultragoal",
    message: "Developer implementing changes...",
  });

  const result = await ccClient.executeTask(parts.join("\n\n"), {
    workingDir,
    timeoutMinutes: task.timeoutMinutes || 30,
    maxTurns: role.maxTurns,
    systemPrompt: "You are a skilled software developer. Implement the assigned task with high quality code. Write clean, idiomatic code following the project's existing patterns. Make focused, minimal changes.",
    allowedTools: role.tools,
    abortSignal,
  });

  // Get git diff summary
  let diffSummary = "";
  try {
    const { execFileSync } = await import("child_process");
    diffSummary = execFileSync("git", ["diff", "--stat"], { cwd: workingDir, encoding: "utf-8" }) || "No changes detected";
  } catch {
    diffSummary = "Changes made (diff unavailable)";
  }

  notify("task.progress", {
    taskId: task.id,
    phase: "ultragoal",
    message: "Implementation complete",
  });

  return {
    developerOutput: result.result,
    diffSummary,
    plan,
  };
}
