/**
 * Phase 1: Deep Interview (Metis)
 *
 * The metis agent clarifies task requirements through structured questioning.
 * For clear, well-defined tasks, this phase can be skipped via canSkip().
 */

import type { CCClient } from "../../cc-integration/cc-client.js";
import type { NotifyFn } from "../omx-pipeline.js";
import { getOmxRole, buildInterviewPrompt, buildInterviewSystemPrompt } from "../omx-roles.js";
import { extractJson } from "../../lib/json-extract.js";
import type { TaskDefinition, TaskContext } from "@ai-workbench/shared";

export interface InterviewArtifacts {
  clarifiedDescription: string;
  constraints: string[];
  edgeCases: string[];
  acceptanceCriteria: string[];
  questions: string[];
  isClear: boolean;
}

export async function runDeepInterview(
  task: TaskDefinition,
  context: TaskContext,
  ccClient: CCClient,
  notify: NotifyFn,
  workingDir: string,
  abortSignal?: AbortSignal,
): Promise<InterviewArtifacts> {
  const role = getOmxRole("metis")!;
  const prompt = buildInterviewPrompt(task.content, context);

  notify("task.progress", {
    taskId: task.id,
    phase: "deep-interview",
    message: "Metis conducting deep interview...",
  });

  const result = await ccClient.executeTask(prompt, {
    workingDir,
    timeoutMinutes: 5,
    maxTurns: role.maxTurns,
    systemPrompt: buildInterviewSystemPrompt(),
    model: undefined,
    abortSignal,
  });

  try {
    const parsed = JSON.parse(extractJson(result.result));
    const artifacts: InterviewArtifacts = {
      clarifiedDescription: parsed.clarifiedDescription ?? task.content,
      constraints: parsed.constraints ?? [],
      edgeCases: parsed.edgeCases ?? [],
      acceptanceCriteria: parsed.acceptanceCriteria ?? [],
      questions: parsed.questions ?? [],
      isClear: parsed.isClear ?? true,
    };

    notify("task.progress", {
      taskId: task.id,
      phase: "deep-interview",
      message: artifacts.isClear
        ? "Task is clear, proceeding"
        : `Identified ${artifacts.questions.length} clarifications`,
    });

    return artifacts;
  } catch {
    return {
      clarifiedDescription: task.content,
      constraints: [],
      edgeCases: [],
      acceptanceCriteria: [],
      questions: [],
      isClear: true,
    };
  }
}

export function canSkipInterview(task: TaskDefinition): boolean {
  const content = task.content.toLowerCase();
  const isShortAndSpecific =
    content.length < 500 &&
    (content.includes("fix") ||
      content.includes("add") ||
      content.includes("update") ||
      content.includes("remove") ||
      content.includes("rename") ||
      content.includes("change"));
  return isShortAndSpecific;
}
