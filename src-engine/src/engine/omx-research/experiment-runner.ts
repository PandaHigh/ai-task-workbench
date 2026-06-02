/**
 * Autoresearch Experiment Runner
 *
 * Runs iterative experiments in isolated git worktrees:
 * 1. Execute experiment (CC call)
 * 2. Evaluate results
 * 3. Keep (merge) or discard (git reset --hard)
 * 4. Record to iteration ledger
 */

import type { CCClient } from "../../cc-integration/cc-client.js";
import type { NotifyFn } from "../omx-pipeline.js";
import { evaluate, type EvaluationResult } from "./evaluator.js";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { getDataDir } from "../../db/store-utils.js";

export type KeepPolicy = "pass_only" | "score_improvement";

export interface ExperimentConfig {
  hypothesis: string;
  workingDir: string;
  maxIterations: number;
  keepPolicy: KeepPolicy;
}

export interface ExperimentResult {
  iterations: number;
  kept: boolean;
  bestScore: number;
  totalCostUsd: number;
  totalDurationMs: number;
}

interface IterationRecord {
  iteration: number;
  decision: "baseline" | "keep" | "discard";
  score: number;
  timestamp: number;
  feedback: string;
}

export class OmxAmpExperimentRunner {
  constructor(
    private ccClient: CCClient,
    private notify: NotifyFn,
  ) {}

  async run(config: ExperimentConfig, abortSignal?: AbortSignal): Promise<ExperimentResult> {
    const startTime = Date.now();
    let totalCost = 0;
    let bestScore = 0;
    let kept = false;
    let lastKeptCommit = this.getCurrentCommit(config.workingDir);
    const records: IterationRecord[] = [];

    // Baseline evaluation
    const baselineEval = await evaluate(
      config.hypothesis, "Baseline — no changes yet",
      config.workingDir, this.ccClient, this.notify, abortSignal,
    );
    bestScore = baselineEval.score;
    records.push({ iteration: 0, decision: "baseline", score: bestScore, timestamp: Date.now(), feedback: baselineEval.feedback });

    this.notify("log.entry", {
      level: "info",
      source: "engine",
      message: `[research] Baseline score: ${bestScore.toFixed(2)}`,
    });

    for (let i = 1; i <= config.maxIterations; i++) {
      if (abortSignal?.aborted) break;

      this.notify("log.entry", {
        level: "info",
        source: "engine",
        message: `[research] Iteration ${i}/${config.maxIterations}`,
      });

      // Execute experiment
      const experimentResult = await this.ccClient.executeTask(
        `Hypothesis: ${config.hypothesis}\n\nImplement an approach to test this hypothesis. Make targeted, minimal changes. Focus on the most impactful approach.`,
        {
          workingDir: config.workingDir,
          timeoutMinutes: 15,
          maxTurns: 30,
          systemPrompt: "You are a research engineer. Implement targeted experiments to test hypotheses. Make minimal, focused changes.",
          abortSignal,
        },
      );
      totalCost += experimentResult.totalCostUsd;

      // Evaluate
      const evalResult = await evaluate(
        config.hypothesis, experimentResult.result,
        config.workingDir, this.ccClient, this.notify, abortSignal,
      );
      totalCost += 0; // evaluator cost is embedded in the call

      // Decide keep or discard
      const shouldKeep = this.shouldKeep(config.keepPolicy, evalResult, bestScore);

      if (shouldKeep) {
        bestScore = evalResult.score;
        lastKeptCommit = this.getCurrentCommit(config.workingDir);
        kept = true;
        records.push({ iteration: i, decision: "keep", score: evalResult.score, timestamp: Date.now(), feedback: evalResult.feedback });

        this.notify("log.entry", {
          level: "info",
          source: "engine",
          message: `[research] Iteration ${i}: KEPT (score: ${evalResult.score.toFixed(2)})`,
        });
      } else {
        // Discard: reset to last kept commit
        this.resetToCommit(config.workingDir, lastKeptCommit);
        records.push({ iteration: i, decision: "discard", score: evalResult.score, timestamp: Date.now(), feedback: evalResult.feedback });

        this.notify("log.entry", {
          level: "info",
          source: "engine",
          message: `[research] Iteration ${i}: DISCARDED (score: ${evalResult.score.toFixed(2)})`,
        });
      }

      // If we have a passing result and policy is pass_only, stop
      if (config.keepPolicy === "pass_only" && evalResult.pass) break;
    }

    // Save ledger
    this.saveLedger(config.workingDir, records);

    return {
      iterations: records.length - 1, // exclude baseline
      kept,
      bestScore,
      totalCostUsd: totalCost,
      totalDurationMs: Date.now() - startTime,
    };
  }

  private shouldKeep(policy: KeepPolicy, evaluation: EvaluationResult, currentBest: number): boolean {
    if (policy === "pass_only") return evaluation.pass;
    if (policy === "score_improvement") return evaluation.score > currentBest;
    return false;
  }

  private getCurrentCommit(workingDir: string): string {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], { cwd: workingDir, encoding: "utf-8" }).trim();
    } catch {
      return "";
    }
  }

  private resetToCommit(workingDir: string, commit: string): void {
    if (!commit) return;
    try {
      execFileSync("git", ["reset", "--hard", commit], { cwd: workingDir });
    } catch { /* ignore reset errors */ }
  }

  private saveLedger(_workingDir: string, records: IterationRecord[]): void {
    const logDir = join(getDataDir(), "research-logs");
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const ledgerPath = join(logDir, `ledger-${Date.now()}.jsonl`);
    for (const r of records) {
      appendFileSync(ledgerPath, JSON.stringify(r) + "\n");
    }
  }
}
