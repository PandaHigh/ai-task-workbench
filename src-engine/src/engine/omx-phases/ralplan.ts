/**
 * Phase 2: RALPLAN Consensus Planning
 *
 * Three-step consensus loop:
 * 1. Planner drafts execution plan
 * 2. Architect reviews for technical correctness
 * 3. Momus (critic) challenges the plan adversarially
 *
 * Consensus is reached when both architect and momus approve.
 * Maximum 10 iterations before giving up.
 */

import type { CCClient } from "../../cc-integration/cc-client.js";
import type { NotifyFn } from "../omx-pipeline.js";
import {
  getOmxRole,
  buildRalplanDraftPrompt,
  buildRalplanSystemPrompt,
  buildArchitectReviewPrompt,
  buildArchitectReviewSystemPrompt,
  buildMomusReviewPrompt,
  buildMomusReviewSystemPrompt,
} from "../omx-roles.js";
import { extractJson } from "../../lib/json-extract.js";
import type { InterviewArtifacts } from "./deep-interview.js";
import type { ExecutionPlan, TaskDefinition, TaskContext } from "@ai-workbench/shared";

export interface RalplanArtifacts {
  plan: ExecutionPlan;
  architectVerdict: { approved: boolean; score: number; summary: string };
  criticVerdict: { approved: boolean; score: number; summary: string };
  iterations: number;
  consensusReached: boolean;
}

export async function runRalplan(
  task: TaskDefinition,
  _context: TaskContext,
  interviewArtifacts: InterviewArtifacts,
  ccClient: CCClient,
  notify: NotifyFn,
  workingDir: string,
  maxIterations: number = 10,
  abortSignal?: AbortSignal,
): Promise<RalplanArtifacts> {
  let plan: ExecutionPlan | null = null;
  let architectVerdict = { approved: false, score: 0, summary: "" };
  let criticVerdict = { approved: false, score: 0, summary: "" };
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    if (abortSignal?.aborted) break;
    iterations = i + 1;

    // Step 1: Draft plan
    notify("task.progress", {
      taskId: task.id,
      phase: "ralplan",
      message: `RALPLAN iteration ${i + 1}: drafting plan...`,
    });

    const draftResult = await ccClient.executeTask(
      buildRalplanDraftPrompt(task.content, interviewArtifacts as unknown as Record<string, unknown>),
      {
        workingDir,
        timeoutMinutes: 10,
        maxTurns: getOmxRole("planner")!.maxTurns,
        systemPrompt: buildRalplanSystemPrompt(),
        abortSignal,
      },
    );

    try {
      plan = JSON.parse(extractJson(draftResult.result)) as ExecutionPlan;
    } catch {
      plan = { understanding: task.content, steps: [task.content], targetFiles: [], risks: ["Failed to parse plan"], testStrategy: "manual" };
    }

    // Step 2: Architect review
    notify("task.progress", {
      taskId: task.id,
      phase: "ralplan",
      message: `RALPLAN iteration ${i + 1}: architect reviewing...`,
    });

    const archResult = await ccClient.executeTask(
      buildArchitectReviewPrompt(plan as unknown as Record<string, unknown>),
      {
        workingDir,
        timeoutMinutes: 5,
        maxTurns: 10,
        systemPrompt: buildArchitectReviewSystemPrompt(),
        abortSignal,
      },
    );

    try {
      architectVerdict = JSON.parse(extractJson(archResult.result));
    } catch {
      architectVerdict = { approved: false, score: 0.3, summary: "Failed to parse architect review" };
    }

    if (!architectVerdict.approved) {
      notify("task.progress", {
        taskId: task.id,
        phase: "ralplan",
        message: `Architect rejected plan (score: ${architectVerdict.score}), iterating...`,
      });
      continue;
    }

    // Step 3: Momus critic review
    notify("task.progress", {
      taskId: task.id,
      phase: "ralplan",
      message: `RALPLAN iteration ${i + 1}: momus critiquing...`,
    });

    const criticResult = await ccClient.executeTask(
      buildMomusReviewPrompt(plan as unknown as Record<string, unknown>),
      {
        workingDir,
        timeoutMinutes: 5,
        maxTurns: getOmxRole("momus")!.maxTurns,
        systemPrompt: buildMomusReviewSystemPrompt(),
        abortSignal,
      },
    );

    try {
      criticVerdict = JSON.parse(extractJson(criticResult.result));
    } catch {
      criticVerdict = { approved: false, score: 0.3, summary: "Failed to parse critic review" };
    }

    if (architectVerdict.approved && criticVerdict.approved) {
      notify("task.progress", {
        taskId: task.id,
        phase: "ralplan",
        message: `Consensus reached after ${i + 1} iterations`,
      });
      break;
    }

    notify("task.progress", {
      taskId: task.id,
      phase: "ralplan",
      message: `Critic rejected plan (score: ${criticVerdict.score}), iterating...`,
    });
  }

  const consensusReached = architectVerdict.approved && criticVerdict.approved;

  return {
    plan: plan ?? { understanding: task.content, steps: [task.content], targetFiles: [], risks: [], testStrategy: "manual" },
    architectVerdict,
    criticVerdict,
    iterations,
    consensusReached,
  };
}
