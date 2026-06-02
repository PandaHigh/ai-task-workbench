/**
 * OMX Gate evaluator for pipeline stage transitions.
 *
 * Each gate is a CC call that produces a structured {passed, score, reason} verdict.
 * Gates enforce quality thresholds before the pipeline can advance.
 */

import type { CCClient } from "../cc-integration/cc-client.js";
import type { NotifyFn } from "./omx-pipeline.js";
import type { OmxAmpStageName } from "./omx-state.js";
import { extractJson } from "../lib/json-extract.js";

export interface GateResult {
  passed: boolean;
  score: number;
  reason: string;
  artifacts?: Record<string, unknown>;
}

const GATE_PROMPTS: Record<string, string> = {
  "deep-interview": `Evaluate whether the deep interview phase is complete.
Check: Are there unresolved ambiguities? Are all constraints identified?
Respond ONLY with valid JSON: { "passed": boolean, "score": 0.0-1.0, "reason": "explanation" }`,

  "ralplan": `Evaluate whether the execution plan is complete and actionable.
Check: Are all steps concrete? Are target files identified? Is the test strategy adequate?
Respond ONLY with valid JSON: { "passed": boolean, "score": 0.0-1.0, "reason": "explanation" }`,

  "ultragoal": `Evaluate whether the implementation is complete.
Check: Were the planned changes actually made? Does the code compile?
Respond ONLY with valid JSON: { "passed": boolean, "score": 0.0-1.0, "reason": "explanation" }`,

  "code-review": `Evaluate the code review outcome.
Check: Are all critical issues resolved? Is the code quality acceptable?
Respond ONLY with valid JSON: { "passed": boolean, "score": 0.0-1.0, "reason": "explanation" }`,

  "ultraqa": `Evaluate the QA test results.
Check: Do all tests pass? Is coverage adequate?
Respond ONLY with valid JSON: { "passed": boolean, "score": 0.0-1.0, "reason": "explanation" }`,
};

const DEFAULT_THRESHOLDS: Record<string, number> = {
  "deep-interview": 0.6,
  "ralplan": 0.7,
  "ultragoal": 0.6,
  "code-review": 0.7,
  "ultraqa": 0.6,
};

export class OmxAmpGate {
  constructor(
    private ccClient: CCClient,
    private notify: NotifyFn,
    private thresholds: Record<string, number> = DEFAULT_THRESHOLDS,
  ) {}

  async evaluate(
    stageName: OmxAmpStageName | string,
    input: Record<string, unknown>,
    workingDir: string,
    abortSignal?: AbortSignal,
  ): Promise<GateResult> {
    const threshold = this.thresholds[stageName] ?? 0.6;
    const gatePrompt = GATE_PROMPTS[stageName];
    if (!gatePrompt) return { passed: true, score: 1.0, reason: "No gate defined for stage" };

    const prompt = `${gatePrompt}\n\n## Stage Output\n${JSON.stringify(input, null, 2)}`;

    try {
      const result = await this.ccClient.executeTask(prompt, {
        workingDir,
        timeoutMinutes: 5,
        maxTurns: 3,
        systemPrompt: "You are a quality gate evaluator. Assess whether the stage output meets the required quality threshold. Respond with valid JSON only.",
        abortSignal,
      });

      const parsed = JSON.parse(extractJson(result.result));
      const gateResult: GateResult = {
        passed: parsed.score >= threshold,
        score: parsed.score ?? 0,
        reason: parsed.reason ?? "No reason provided",
      };

      this.notify("log.entry", {
        level: "info",
        source: "engine",
        message: `[gate:${stageName}] score=${gateResult.score.toFixed(2)} passed=${gateResult.passed} threshold=${threshold}`,
      });

      return gateResult;
    } catch (err) {
      return {
        passed: false,
        score: 0,
        reason: `Gate evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  canSkip(stageName: string, taskContent: string, artifacts: Record<string, unknown>): boolean {
    if (stageName === "deep-interview") {
      const content = taskContent.toLowerCase();
      const isSpecific = content.length > 50 && (
        content.includes("fix") || content.includes("add") ||
        content.includes("update") || content.includes("remove") ||
        content.includes("refactor") || content.includes("implement")
      );
      const hasConstraints = !!artifacts.constraints || !!artifacts.acceptanceCriteria;
      return isSpecific && content.length < 500 && !hasConstraints;
    }
    return false;
  }
}
