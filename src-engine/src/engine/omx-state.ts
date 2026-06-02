/**
 * OMX ModeState persistence layer.
 *
 * Tracks pipeline stage progress for each run, enabling:
 * - Stage-level checkpointing at phase boundaries
 * - Crash recovery by resuming from last completed stage
 * - Cost/duration snapshots for budget tracking
 */

import { readJsonFile, writeJsonFile, getDataDir } from "../db/store-utils.js";
import { join } from "path";
import { unlinkSync } from "fs";

// ─── Types ──────────────────────────────────────────────────────────────────

export type OmxAmpStageName = "deep-interview" | "ralplan" | "ultragoal" | "code-review" | "ultraqa";

export interface OmxAmpModeState {
  mode: "pipeline" | "team" | "research";
  stageIndex: number;
  stageName: OmxAmpStageName | string;
  status: "pending" | "running" | "passed" | "failed" | "gating";
  artifacts: Record<string, unknown>;
  startedAt: number;
  updatedAt: number;
  iteration: number;
  maxIterations: number;
}

export interface OmxAmpRunState {
  runId: string;
  pipeline: {
    stages: OmxAmpModeState[];
    currentStageIndex: number;
    reviewCycle: number;
    maxRalplanIterations: number;
  };
  snapshot: {
    totalCostUsd: number;
    totalDurationMs: number;
    lastStagePassed: string | null;
    interruptibleAt: number;
  };
  createdAt: number;
  updatedAt: number;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const OMX_STAGES: OmxAmpStageName[] = ["deep-interview", "ralplan", "ultragoal", "code-review", "ultraqa"];

function createInitialModeState(stageName: string, index: number): OmxAmpModeState {
  return {
    mode: "pipeline",
    stageIndex: index,
    stageName,
    status: "pending",
    artifacts: {},
    startedAt: 0,
    updatedAt: Date.now(),
    iteration: 0,
    maxIterations: 10,
  };
}

export function createInitialRunState(runId: string): OmxAmpRunState {
  const now = Date.now();
  return {
    runId,
    pipeline: {
      stages: OMX_STAGES.map((name, i) => createInitialModeState(name, i)),
      currentStageIndex: 0,
      reviewCycle: 0,
      maxRalplanIterations: 10,
    },
    snapshot: {
      totalCostUsd: 0,
      totalDurationMs: 0,
      lastStagePassed: null,
      interruptibleAt: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Store ──────────────────────────────────────────────────────────────────

function stateFilePath(runId: string): string {
  return join(getDataDir(), "runs", runId, "omx-state.json");
}

export class OmxAmpStateStore {
  private cache = new Map<string, OmxAmpRunState>();

  save(runId: string, state: OmxAmpRunState): void {
    state.updatedAt = Date.now();
    this.cache.set(runId, state);
    writeJsonFile(stateFilePath(runId), state);
  }

  load(runId: string): OmxAmpRunState | null {
    if (this.cache.has(runId)) return this.cache.get(runId)!;
    const state = readJsonFile<OmxAmpRunState | null>(stateFilePath(runId), null, "omx-state");
    if (state) this.cache.set(runId, state);
    return state;
  }

  updateStage(runId: string, stageIndex: number, patch: Partial<OmxAmpModeState>): void {
    const state = this.load(runId);
    if (!state) return;
    const stage = state.pipeline.stages[stageIndex];
    if (!stage) return;
    Object.assign(stage, patch, { updatedAt: Date.now() });
    state.pipeline.currentStageIndex = stageIndex;
    if (patch.status === "passed") {
      state.snapshot.lastStagePassed = stage.stageName;
      state.snapshot.interruptibleAt = stageIndex + 1;
    }
    this.save(runId, state);
  }

  updateSnapshot(runId: string, patch: Partial<OmxAmpRunState["snapshot"]>): void {
    const state = this.load(runId);
    if (!state) return;
    Object.assign(state.snapshot, patch);
    this.save(runId, state);
  }

  incrementReviewCycle(runId: string): void {
    const state = this.load(runId);
    if (!state) return;
    state.pipeline.reviewCycle++;
    this.save(runId, state);
  }

  getResumableIndex(runId: string): number {
    const state = this.load(runId);
    if (!state) return -1;
    return state.snapshot.interruptibleAt;
  }

  canResume(runId: string): boolean {
    const state = this.load(runId);
    if (!state) return false;
    const idx = state.snapshot.interruptibleAt;
    return idx > 0 && idx < state.pipeline.stages.length;
  }

  resetStage(runId: string, stageIndex: number): void {
    const state = this.load(runId);
    if (!state) return;
    // Reset this stage and all subsequent stages
    for (let i = stageIndex; i < state.pipeline.stages.length; i++) {
      state.pipeline.stages[i] = createInitialModeState(
        state.pipeline.stages[i].stageName,
        i,
      );
    }
    state.pipeline.currentStageIndex = stageIndex;
    this.save(runId, state);
  }

  clear(runId: string): void {
    this.cache.delete(runId);
    try { unlinkSync(stateFilePath(runId)); } catch { /* file may not exist */ }
  }

  getStages(): typeof OMX_STAGES {
    return OMX_STAGES;
  }

  getStageIndex(name: string): number {
    return OMX_STAGES.indexOf(name as OmxAmpStageName);
  }
}
