/**
 * Evaluator for Autoresearch experiments.
 *
 * Uses a CC call to evaluate experiment results and produce a structured verdict.
 */

import type { CCClient } from "../../cc-integration/cc-client.js";
import type { NotifyFn } from "../omx-pipeline.js";

export interface EvaluationResult {
  pass: boolean;
  score: number;
  feedback: string;
}

export async function evaluate(
  hypothesis: string,
  experimentOutput: string,
  workingDir: string,
  ccClient: CCClient,
  _notify: NotifyFn,
  abortSignal?: AbortSignal,
): Promise<EvaluationResult> {
  const prompt = `## Hypothesis
${hypothesis}

## Experiment Output
${experimentOutput}

## Instructions
Evaluate whether the experiment output supports the hypothesis.
Assess correctness, quality, and completeness.
Provide a score from 0.0 to 1.0.

Respond ONLY with valid JSON:
{
  "pass": true_or_false,
  "score": 0.0_to_1.0,
  "feedback": "detailed evaluation"
}`;

  try {
    const result = await ccClient.executeTask(prompt, {
      workingDir,
      timeoutMinutes: 5,
      maxTurns: 5,
      systemPrompt: "You are a scientific evaluator. Assess experiment results objectively. Respond with valid JSON only.",
      abortSignal,
    });

    return JSON.parse(result.result);
  } catch {
    return { pass: false, score: 0, feedback: "Evaluation failed" };
  }
}
