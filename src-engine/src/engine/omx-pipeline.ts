/**
 * OMX 5-stage Pipeline Orchestrator
 *
 * Replaces the old 4-phase TaskPipeline with an OMX-style pipeline:
 *   deep-interview → ralplan → ultragoal → code-review → ultraqa
 *
 * Key differences from old pipeline:
 * - 5 stages instead of 4
 * - Gate evaluation between stages
 * - code-review/ultraqa failure loops back to ralplan (not developer)
 * - ModeState persistence for crash recovery
 * - RALPLAN consensus (architect + critic) for plan quality
 */

import type { CCClient, CCMessage } from "../cc-integration/cc-client.js";
import type { TaskDefinition, ExecutionPlan, TestResult, ReviewResult, TaskContext, PhaseRecord, TaskPhase } from "@ai-workbench/shared";
import { OmxAmpStateStore, createInitialRunState } from "./omx-state.js";
import { OmxAmpGate } from "./omx-gate.js";

import { runDeepInterview, canSkipInterview, type InterviewArtifacts } from "./omx-phases/deep-interview.js";
import { runRalplan, type RalplanArtifacts } from "./omx-phases/ralplan.js";
import { runUltragoal, type UltragoalArtifacts } from "./omx-phases/ultragoal.js";
import { runCodeReview, type CodeReviewArtifacts } from "./omx-phases/code-review.js";
import { runUltraQa, type UltraQaArtifacts } from "./omx-phases/ultraqa.js";

export type NotifyFn = (method: string, params: unknown) => void;

// ─── Pipeline config ────────────────────────────────────────────────────────

export interface OmxAmpPipelineConfig {
  maxRalplanIterations: number;
  maxGateRetries: number;
  gateThresholds: Record<string, number>;
}

const DEFAULT_CONFIG: OmxAmpPipelineConfig = {
  maxRalplanIterations: 3,
  maxGateRetries: 2,
  gateThresholds: {
    "deep-interview": 0.6,
    "ralplan": 0.7,
    "ultragoal": 0.6,
    "code-review": 0.7,
    "ultraqa": 0.6,
  },
};

// ─── Pipeline result (compatible with old PipelineResult) ───────────────────

export interface OmxAmpPipelineResult {
  finalOutput: string;
  sessionId: string;
  totalCostUsd: number;
  durationMs: number;
  numTurns: number;
  messages: CCMessage[];
  phases: PhaseRecord[];
  iterations: number;
  plan?: ExecutionPlan;
  testResult?: TestResult;
  reviewResult?: ReviewResult;
}

// ─── Stage-to-phase mapping for frontend compatibility ───────────────────────

const STAGE_PHASE_MAP: Record<string, TaskPhase> = {
  "deep-interview": "planner",
  "ralplan": "planner",
  "ultragoal": "developer",
  "code-review": "reviewer",
  "ultraqa": "tester",
};

// ─── Pipeline class ─────────────────────────────────────────────────────────

export class OmxAmpPipeline {
  private stateStore = new OmxAmpStateStore();
  private gate: OmxAmpGate;
  private startTime = 0;
  private messages: CCMessage[] = [];
  private phases: PhaseRecord[] = [];
  private totalCost = 0;
  private totalTurns = 0;

  constructor(
    private ccClient: CCClient,
    private notify: NotifyFn,
    private workingDir: string,
    private config: OmxAmpPipelineConfig = DEFAULT_CONFIG,
  ) {
    this.gate = new OmxAmpGate(ccClient, notify, config.gateThresholds);
  }

  async run(
    task: TaskDefinition,
    context: TaskContext,
    abortSignal?: AbortSignal,
  ): Promise<OmxAmpPipelineResult> {
    this.startTime = Date.now();
    this.messages = [];
    this.phases = [];
    this.totalCost = 0;
    this.totalTurns = 0;

    const state = createInitialRunState(task.runId);
    this.stateStore.save(task.runId, state);

    // Check for resumable state
    const resumableIdx = this.stateStore.getResumableIndex(task.runId);
    const startIdx = resumableIdx >= 0 ? resumableIdx : 0;

    const stages = this.stateStore.getStages();
    let reviewCycle = 0;
    let lastFeedback = "";

    let interviewArtifacts: InterviewArtifacts = {
      clarifiedDescription: task.content,
      constraints: [],
      edgeCases: [],
      acceptanceCriteria: [],
      questions: [],
      isClear: true,
    };
    let ralplanArtifacts: RalplanArtifacts | null = null;
    let ultragoalArtifacts: UltragoalArtifacts | null = null;
    let codeReviewArtifacts: CodeReviewArtifacts | null = null;
    let ultraQaArtifacts: UltraQaArtifacts | null = null;

    let i = startIdx;
    while (i < stages.length) {
      if (abortSignal?.aborted) break;
      const stageName = stages[i];

      this.notify("task.progress", {
        taskId: task.id,
        phase: STAGE_PHASE_MAP[stageName] ?? stageName,
        message: `Starting stage: ${stageName}`,
      });

      this.stateStore.updateStage(task.runId, i, { status: "running", startedAt: Date.now() });
      this.recordPhase(stageName, "running");

      try {
        switch (stageName) {
          case "deep-interview": {
            if (canSkipInterview(task)) {
              this.stateStore.updateStage(task.runId, i, { status: "passed" });
              this.recordPhase(stageName, "skipped");
              break;
            }
            interviewArtifacts = await runDeepInterview(task, context, this.ccClient, this.notify, this.workingDir, abortSignal);
            const interviewGate = await this.gate.evaluate(stageName, interviewArtifacts as unknown as Record<string, unknown>, this.workingDir, abortSignal);
            if (!interviewGate.passed) {
              this.stateStore.updateStage(task.runId, i, { status: "gating" });
              this.recordPhase(stageName, "gating");
              this.notify("task.progress", { taskId: task.id, phase: "planner", message: `Gate failed: ${interviewGate.reason}` });
            } else {
              this.stateStore.updateStage(task.runId, i, { status: "passed", artifacts: interviewArtifacts as unknown as Record<string, unknown> });
              this.recordPhase(stageName, "completed");
            }
            break;
          }

          case "ralplan": {
            ralplanArtifacts = await runRalplan(
              task, context, interviewArtifacts,
              this.ccClient, this.notify, this.workingDir,
              this.config.maxRalplanIterations, abortSignal,
            );
            const ralplanGate = await this.gate.evaluate(stageName, ralplanArtifacts as unknown as Record<string, unknown>, this.workingDir, abortSignal);
            if (!ralplanGate.passed) {
              this.stateStore.updateStage(task.runId, i, { status: "gating" });
              this.recordPhase(stageName, "gating");
              this.notify("task.progress", { taskId: task.id, phase: "planner", message: `Gate failed: ${ralplanGate.reason}` });
            } else {
              this.stateStore.updateStage(task.runId, i, { status: "passed", artifacts: ralplanArtifacts as unknown as Record<string, unknown> });
              this.recordPhase(stageName, "completed");
            }
            break;
          }

          case "ultragoal": {
            if (!ralplanArtifacts) throw new Error("Missing ralplan artifacts");
            ultragoalArtifacts = await runUltragoal(
              task, { goals: context.goals, lessonsLearned: context.lessonsLearned },
              ralplanArtifacts, this.ccClient, this.notify, this.workingDir,
              lastFeedback || undefined, abortSignal,
            );
            const ultraGate = await this.gate.evaluate(stageName, ultragoalArtifacts as unknown as Record<string, unknown>, this.workingDir, abortSignal);
            if (!ultraGate.passed) {
              this.stateStore.updateStage(task.runId, i, { status: "gating" });
              this.recordPhase(stageName, "gating");
              this.notify("task.progress", { taskId: task.id, phase: "developer", message: `Gate failed: ${ultraGate.reason}` });
            } else {
              this.stateStore.updateStage(task.runId, i, { status: "passed", artifacts: ultragoalArtifacts as unknown as Record<string, unknown> });
              this.recordPhase(stageName, "completed");
            }
            break;
          }

          case "code-review": {
            if (!ralplanArtifacts || !ultragoalArtifacts) throw new Error("Missing upstream artifacts");
            codeReviewArtifacts = await runCodeReview(
              task, ralplanArtifacts.plan, ultragoalArtifacts,
              this.ccClient, this.notify, this.workingDir, abortSignal,
            );
            this.stateStore.updateStage(task.runId, i, { status: codeReviewArtifacts.reviewResult.approved ? "passed" : "failed", artifacts: codeReviewArtifacts as unknown as Record<string, unknown> });
            this.recordPhase(stageName, codeReviewArtifacts.reviewResult.approved ? "completed" : "failed");

            if (!codeReviewArtifacts.reviewResult.approved) {
              lastFeedback = codeReviewArtifacts.combinedFeedback;
              reviewCycle++;
              if (reviewCycle >= this.config.maxGateRetries) {
                this.stateStore.updateStage(task.runId, i, { status: "failed" });
                return this.buildResult(task, "Code review failed after max retries", ralplanArtifacts?.plan, codeReviewArtifacts?.reviewResult, ultraQaArtifacts?.testResult);
              }
              // Loop back to ralplan
              i = this.stateStore.getStageIndex("ralplan");
              this.stateStore.resetStage(task.runId, i);
              this.stateStore.incrementReviewCycle(task.runId);
              this.notify("task.progress", {
                taskId: task.id,
                phase: "reviewer",
                message: `Review cycle ${reviewCycle}: looping back to RALPLAN`,
              });
              continue;
            }
            break;
          }

          case "ultraqa": {
            if (!ralplanArtifacts || !ultragoalArtifacts) throw new Error("Missing upstream artifacts");
            ultraQaArtifacts = await runUltraQa(
              task, ralplanArtifacts.plan, ultragoalArtifacts,
              this.ccClient, this.notify, this.workingDir, abortSignal,
            );
            this.stateStore.updateStage(task.runId, i, { status: ultraQaArtifacts.testResult.allPassed ? "passed" : "failed", artifacts: ultraQaArtifacts as unknown as Record<string, unknown> });
            this.recordPhase(stageName, ultraQaArtifacts.testResult.allPassed ? "completed" : "failed");

            if (!ultraQaArtifacts.testResult.allPassed) {
              lastFeedback = `Test failures:\n${ultraQaArtifacts.testResult.failures.map((f) => `- ${f}`).join("\n")}`;
              reviewCycle++;
              if (reviewCycle >= this.config.maxGateRetries) {
                this.stateStore.updateStage(task.runId, i, { status: "failed" });
                return this.buildResult(task, "QA failed after max retries", ralplanArtifacts?.plan, codeReviewArtifacts?.reviewResult, ultraQaArtifacts.testResult);
              }
              // Loop back to ralplan
              i = this.stateStore.getStageIndex("ralplan");
              this.stateStore.resetStage(task.runId, i);
              this.stateStore.incrementReviewCycle(task.runId);
              this.notify("task.progress", {
                taskId: task.id,
                phase: "tester",
                message: `QA cycle ${reviewCycle}: looping back to RALPLAN`,
              });
              continue;
            }
            break;
          }
        }
      } catch (err) {
        this.stateStore.updateStage(task.runId, i, { status: "failed" });
        this.recordPhase(stageName, "error");
        if (abortSignal?.aborted) break;
        throw err;
      }

      i++;
    }

    return this.buildResult(
      task,
      ultragoalArtifacts?.developerOutput ?? "Pipeline completed",
      ralplanArtifacts?.plan,
      codeReviewArtifacts?.reviewResult,
      ultraQaArtifacts?.testResult,
    );
  }

  private recordPhase(stageName: string, _status: string): void {
    this.phases.push({
      phase: STAGE_PHASE_MAP[stageName] ?? (stageName as TaskPhase),
      durationMs: 0,
      costUsd: 0,
      turns: 0,
      iteration: this.phases.length + 1,
    });
  }

  private buildResult(
    _task: TaskDefinition,
    output: string,
    plan?: ExecutionPlan,
    reviewResult?: ReviewResult,
    testResult?: TestResult,
  ): OmxAmpPipelineResult {
    const durationMs = Date.now() - this.startTime;
    return {
      finalOutput: output,
      sessionId: "",
      totalCostUsd: this.totalCost,
      durationMs,
      numTurns: this.totalTurns,
      messages: this.messages,
      phases: this.phases,
      iterations: this.phases.length,
      plan,
      testResult,
      reviewResult,
    };
  }
}
