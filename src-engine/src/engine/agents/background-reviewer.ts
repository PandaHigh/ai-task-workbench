import type { ReviewResult, ReviewSuggestion } from "@ai-workbench/shared";
import type { AgentExecutor } from "./agent-executor.js";
import { REVIEWER_ROLE } from "./agent-role.js";
import { GitManager } from "../../git/git-manager.js";
import { WorktreeManager } from "../../git/worktree-manager.js";
import { parseJsonOrThrow } from "../../lib/json-extract.js";
import { Store } from "../../db/store.js";
import { randomUUID } from "crypto";

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

interface BackgroundReviewParams {
  runId: string;
  taskId: string;
  workingDir: string;
  plan?: { understanding: string; steps: string[]; targetFiles: string[] };
  testResult?: { testsWritten: string[]; allPassed: boolean; failures: string[] };
  developerOutput?: string;
}

export class BackgroundReviewer {
  constructor(
    private agentExecutor: AgentExecutor,
    private store: Store,
    private notify: NotifyFn,
  ) {}

  async runBackgroundReview(params: BackgroundReviewParams): Promise<ReviewSuggestion | null> {
    const { runId, taskId, workingDir } = params;
    const branchName = `review-${taskId.slice(0, 8)}`;
    const worktreeManager = new WorktreeManager();
    let worktreePath: string | null = null;

    try {
      worktreePath = await worktreeManager.create(workingDir, branchName);

      const diffSummary = await this.getDiffSummary(workingDir);
      const prompt = this.buildReviewPrompt(params, diffSummary);

      const result = await this.agentExecutor.execute(
        REVIEWER_ROLE,
        prompt,
        worktreePath,
        { taskId },
      );

      const review = this.parseReviewResult(result.output);
      if (!review) return null;

      const suggestion: ReviewSuggestion = {
        id: randomUUID().slice(0, 12),
        runId,
        taskId,
        issues: review.issues,
        summary: review.summary,
        score: review.score,
        status: "pending",
        createdAt: Date.now(),
      };

      this.store.appendSuggestion(runId, suggestion);
      this.notify("review.suggestion", { suggestion });
      return suggestion;
    } catch (err) {
      console.warn("[background-reviewer] failed:", err instanceof Error ? err.message : err);
      return null;
    } finally {
      if (worktreePath) {
        try {
          await worktreeManager.remove(workingDir, worktreePath, branchName);
        } catch {
          // Best-effort cleanup
        }
      }
    }
  }

  private buildReviewPrompt(params: BackgroundReviewParams, diffSummary: string): string {
    const parts: string[] = [
      "请对以下代码变更进行独立审查。",
    ];
    if (params.plan) {
      parts.push(`\n执行计划:\n${params.plan.steps.join("\n")}`);
    }
    if (params.testResult) {
      parts.push(`\n测试结果: ${params.testResult.allPassed ? "全部通过" : `有 ${params.testResult.failures.length} 个失败`}`);
    }
    parts.push(`\n代码变更摘要:\n${diffSummary || "无变更"}`);
    parts.push('\n请以 JSON 格式输出审查结果: { "approved": boolean, "score": number (0-1), "issues": [{ "severity": "critical"|"major"|"minor", "file": string, "line"?: number, "description": string, "suggestion": string }], "summary": string }');
    return parts.join("\n");
  }

  private parseReviewResult(output: string): ReviewResult | null {
    try {
      return parseJsonOrThrow<ReviewResult>(output);
    } catch {
      return null;
    }
  }

  private async getDiffSummary(workingDir: string): Promise<string> {
    try {
      const git = new GitManager({ workingDir });
      return await git.getDiff();
    } catch {
      return "";
    }
  }
}
