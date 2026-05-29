# Multi-Agent Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single claude -p task execution with a 4-phase agent pipeline (planner → developer → tester → reviewer) with automatic fix loops.

**Architecture:** New `TaskPipeline` class orchestrates 4 independent claude -p calls per task, passing context via prompt injection. Reviewer rejection triggers a fix loop back to developer (max 3 iterations). Executor delegates to TaskPipeline instead of calling CCClient directly.

**Tech Stack:** TypeScript, Node.js, claude CLI (claude -p), ws (WebSocket)

---

## File Structure

| Operation | File | Responsibility |
|-----------|------|---------------|
| Create | `src-engine/src/engine/pipeline-prompts.ts` | System prompt templates for planner, developer, tester, reviewer |
| Create | `src-engine/src/engine/task-pipeline.ts` | TaskPipeline class: orchestrates 4 phases + fix loop |
| Modify | `shared/src/enums.ts` | Add `TaskPhase` type, simplify `ExecutionMode` |
| Modify | `shared/src/task-types.ts` | Add pipeline types (ExecutionPlan, TestResult, ReviewResult, etc.) |
| Modify | `src-engine/src/engine/executor.ts` | Replace executeSingleTask internals with TaskPipeline call |
| Modify | `src-engine/src/json-rpc/methods.ts` | Remove parallel mode RPC handlers, add pipeline config keys |
| Delete | `src-engine/src/engine/worker-agent.ts` | No longer needed |
| Delete | `src-engine/src/engine/agent-roles.ts` | Roles moved into pipeline-prompts |

---

### Task 1: Shared Types — Enums

**Files:**
- Modify: `shared/src/enums.ts`

- [ ] **Step 1: Add TaskPhase type and simplify ExecutionMode**

Replace the multi-agent section in `shared/src/enums.ts` (lines 42-44):

```ts
// Remove these lines:
// export type ExecutionMode = "sequential" | "parallel";
// export type AgentRoleType = "developer" | "tester" | "reviewer" | "custom";

// Replace with:
export type TaskPhase = "planner" | "developer" | "tester" | "reviewer";
```

The full section should become:

```ts
// ─── Pipeline phases ──────────────────────────────────────────────────

export type TaskPhase = "planner" | "developer" | "tester" | "reviewer";
```

- [ ] **Step 2: Commit**

```bash
git add shared/src/enums.ts
git commit -m "refactor: replace ExecutionMode/AgentRoleType with TaskPhase for pipeline"
```

---

### Task 2: Shared Types — Pipeline Interfaces

**Files:**
- Modify: `shared/src/task-types.ts`

- [ ] **Step 1: Add pipeline types and update TaskDefinition**

In `shared/src/task-types.ts`, add these imports at line 1 (add `TaskPhase` to the import from enums):

```ts
import type {
  TaskStatus,
  RunStatus,
  TaskType,
  LessonCategory,
  GoalStatus,
  CheckpointType,
  ApprovalStatus,
  TaskPhase,
  UserRole,
} from "./enums.js";
```

Add the following interfaces after the `SmartTask` interface (after line 178):

```ts
// ─── Pipeline types ─────────────────────────────────────────────────────

export interface ExecutionPlan {
  understanding: string;
  steps: string[];
  targetFiles: string[];
  risks: string[];
  testStrategy: string;
}

export interface TestResult {
  testsWritten: string[];
  allPassed: boolean;
  failures: string[];
  coverage: string;
}

export interface ReviewIssue {
  severity: "critical" | "major" | "minor";
  file: string;
  line?: number;
  description: string;
  suggestion: string;
}

export interface ReviewResult {
  approved: boolean;
  score: number;
  issues: ReviewIssue[];
  summary: string;
}

export interface PhaseRecord {
  phase: TaskPhase;
  durationMs: number;
  costUsd: number;
  turns: number;
  iteration: number;
}
```

Add `pipelinePhases` and `pipelineIterations` to `TaskDefinition` (after line 36, before `assignedRoleId`):

```ts
  pipelinePhases?: PhaseRecord[];
  pipelineIterations?: number;
```

Remove from `ExecutionRun` (lines 69-71):
- `executionMode?: ExecutionMode;`
- `maxConcurrentAgents?: number;`
- `agentRoles?: AgentRole[];`

Remove the `assignedRoleId` field from `TaskDefinition` (line 36).

Remove the `ExecutionMode` and `AgentRoleType` imports from the import statement at line 1 (they no longer exist in enums).

Also remove the `AgentRole` interface (lines 228-234) since roles are now embedded in pipeline-prompts.

- [ ] **Step 2: Commit**

```bash
git add shared/src/task-types.ts
git commit -m "feat: add pipeline types (ExecutionPlan, TestResult, ReviewResult, PhaseRecord)"
```

---

### Task 3: Pipeline Prompts

**Files:**
- Create: `src-engine/src/engine/pipeline-prompts.ts`

- [ ] **Step 1: Create pipeline-prompts.ts**

```ts
import type { ExecutionPlan, TestResult, ReviewResult, TaskContext } from "@ai-workbench/shared";

export function buildPlannerPrompt(taskContent: string, context: TaskContext): string {
  return `You are a software architect. Analyze the following task and create a concrete execution plan.

## Task
${taskContent}

## Project Goals
${context.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}

${context.lastTenCommits.length > 0 ? `## Recent Commits\n${context.lastTenCommits.slice(-5).map((c) => `- ${c.hash.substring(0, 7)} ${c.message}`).join("\n")}` : ""}

${context.lessonsLearned.length > 0 ? `## Lessons from Previous Failures\n${context.lessonsLearned.slice(-10).map((l) => `- [${l.category}] ${l.lesson}`).join("\n")}` : ""}

## Instructions
1. Read the project files to understand the codebase structure
2. Identify exactly which files need to be created or modified
3. Break the task into 3-8 concrete implementation steps
4. Identify risks and edge cases
5. Define a testing strategy

Respond ONLY with valid JSON:
{
  "understanding": "your understanding of the task",
  "steps": ["step 1", "step 2", ...],
  "targetFiles": ["path/to/file1.ts", ...],
  "risks": ["risk 1", ...],
  "testStrategy": "how to test this change"
}`;
}

export function buildPlannerSystemPrompt(): string {
  return "You are a software architect. You analyze tasks and produce concrete, actionable execution plans. You must respond with valid JSON only.";
}

export function buildDeveloperPrompt(taskContent: string, plan: ExecutionPlan, fixFeedback?: string): string {
  const parts: string[] = [];

  parts.push(`## Task
${taskContent}`);

  parts.push(`## Execution Plan
Understanding: ${plan.understanding}
Steps:
${plan.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}
Target Files: ${plan.targetFiles.join(", ")}
Risks: ${plan.risks.join("; ")}`);

  if (fixFeedback) {
    parts.push(`## Previous Attempt Feedback
The reviewer rejected your previous changes. Please fix the following issues:

${fixFeedback}

IMPORTANT: Address ALL the issues above. Do not just fix one and ignore the rest.`);
  }

  parts.push(`## Instructions
Implement the task following the execution plan. Make focused, minimal changes. Follow the project's existing code patterns.`);

  return parts.join("\n\n");
}

export function buildDeveloperSystemPrompt(): string {
  return `You are a skilled software developer. Your job is to implement the assigned task with high quality code.

Guidelines:
- Write clean, idiomatic code following the project's existing patterns
- Add appropriate error handling at system boundaries
- Prefer editing existing files over creating new ones
- Do not add unnecessary abstractions or features beyond what the task requires
- Ensure your changes are minimal and focused on the task at hand`;
}

export function buildTesterPrompt(plan: ExecutionPlan, diffSummary: string): string {
  return `## Execution Plan
${plan.understanding}
Steps: ${plan.steps.join("; ")}
Target Files: ${plan.targetFiles.join(", ")}

## Recent Code Changes
${diffSummary}

## Test Strategy
${plan.testStrategy}

## Instructions
1. Write tests to verify the code changes above
2. Use the project's existing test framework and conventions
3. Test both happy paths and edge cases
4. Run the tests and report results
5. If existing tests are broken, fix them

Respond ONLY with valid JSON:
{
  "testsWritten": ["path/to/test1.ts", ...],
  "allPassed": true_or_false,
  "failures": ["failure description 1", ...],
  "coverage": "description of what was tested"
}`;
}

export function buildTesterSystemPrompt(): string {
  return `You are a quality assurance engineer. Your job is to write tests and verify that the codebase works correctly.

Guidelines:
- Write unit tests and integration tests as appropriate
- Test both happy paths and edge cases
- Use the project's existing test framework and conventions
- Verify that existing tests still pass after changes
- Report any issues found during testing`;
}

export function buildReviewerPrompt(plan: ExecutionPlan, diffSummary: string, testResult: TestResult): string {
  return `## Execution Plan
${plan.understanding}

## Code Changes
${diffSummary}

## Test Results
Tests written: ${testResult.testsWritten.join(", ") || "none"}
All passed: ${testResult.allPassed}
${testResult.failures.length > 0 ? `Failures:\n${testResult.failures.map((f) => `- ${f}`).join("\n")}` : "No failures"}
Coverage: ${testResult.coverage}

## Instructions
Review the code changes for quality, correctness, and potential issues. Be thorough but fair.

1. Check for correctness, edge cases, and error handling
2. Look for security vulnerabilities (OWASP top 10)
3. Verify the code follows project conventions
4. Assess test coverage adequacy
5. Provide specific, actionable feedback

Respond ONLY with valid JSON:
{
  "approved": true_or_false,
  "score": 0.0_to_1.0,
  "issues": [
    { "severity": "critical"|"major"|"minor", "file": "path", "line": 123, "description": "what's wrong", "suggestion": "how to fix" }
  ],
  "summary": "brief review summary"
}`;
}

export function buildReviewerSystemPrompt(): string {
  return `You are a code reviewer. Your job is to review code changes for quality, correctness, and potential issues.

Guidelines:
- Check for correctness, edge cases, and error handling
- Look for security vulnerabilities (OWASP top 10)
- Verify the code follows project conventions
- Identify any missing tests
- Provide specific, actionable feedback`;
}

export function buildFixFeedback(reviewResult: ReviewResult, testResult: TestResult): string {
  const parts: string[] = [];

  parts.push(`### Reviewer Feedback:\n${reviewResult.summary}`);

  if (reviewResult.issues.length > 0) {
    const critical = reviewResult.issues.filter((i) => i.severity === "critical");
    const major = reviewResult.issues.filter((i) => i.severity === "major");
    const minor = reviewResult.issues.filter((i) => i.severity === "minor");

    if (critical.length > 0) {
      parts.push(`### Critical Issues:\n${critical.map((i) => `- [${i.file}${i.line ? `:${i.line}` : ""}] ${i.description}\n  Fix: ${i.suggestion}`).join("\n")}`);
    }
    if (major.length > 0) {
      parts.push(`### Major Issues:\n${major.map((i) => `- [${i.file}${i.line ? `:${i.line}` : ""}] ${i.description}\n  Fix: ${i.suggestion}`).join("\n")}`);
    }
    if (minor.length > 0) {
      parts.push(`### Minor Issues:\n${minor.map((i) => `- [${i.file}${i.line ? `:${i.line}` : ""}] ${i.description}\n  Fix: ${i.suggestion}`).join("\n")}`);
    }
  }

  if (testResult.failures.length > 0) {
    parts.push(`### Test Failures:\n${testResult.failures.map((f) => `- ${f}`).join("\n")}`);
  }

  return parts.join("\n\n");
}
```

- [ ] **Step 2: Commit**

```bash
git add src-engine/src/engine/pipeline-prompts.ts
git commit -m "feat: add pipeline prompt templates for planner, developer, tester, reviewer"
```

---

### Task 4: TaskPipeline Core

**Files:**
- Create: `src-engine/src/engine/task-pipeline.ts`

- [ ] **Step 1: Create task-pipeline.ts**

```ts
import type {
  TaskDefinition,
  TaskContext,
  ExecutionPlan,
  TestResult,
  ReviewResult,
  PhaseRecord,
  TaskPhase,
} from "@ai-workbench/shared";
import type { CCClient, CCTaskResult, CCMessage } from "../cc-integration/cc-client.js";
import { GitManager } from "../git/git-manager.js";
import {
  buildPlannerPrompt,
  buildPlannerSystemPrompt,
  buildDeveloperPrompt,
  buildDeveloperSystemPrompt,
  buildTesterPrompt,
  buildTesterSystemPrompt,
  buildReviewerPrompt,
  buildReviewerSystemPrompt,
  buildFixFeedback,
} from "./pipeline-prompts.js";

export interface PipelineResult {
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

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

const DEFAULT_PIPELINE_CONFIG = {
  maxFixIterations: 3,
  plannerMaxTurns: 15,
  developerMaxTurns: 40,
  testerMaxTurns: 25,
  reviewerMaxTurns: 20,
};

export class TaskPipeline {
  private config = { ...DEFAULT_PIPELINE_CONFIG };

  constructor(
    private ccClient: CCClient,
    private notify: NotifyFn,
    private workingDir: string,
    config?: Partial<typeof DEFAULT_PIPELINE_CONFIG>,
  ) {
    if (config) {
      Object.assign(this.config, config);
    }
  }

  async run(
    task: TaskDefinition,
    context: TaskContext,
    abortSignal?: AbortSignal,
  ): Promise<PipelineResult> {
    const allMessages: CCMessage[] = [];
    const phases: PhaseRecord[] = [];
    let totalCost = 0;
    let totalDuration = 0;
    let totalTurns = 0;
    let lastSessionId = "";

    // ─── Phase 1: Planner ─────────────────────────────────────
    this.broadcastPhase(task.id, context.runId!, "planner", 1);

    let plan: ExecutionPlan;
    try {
      const plannerResult = await this.executeCC(
        buildPlannerPrompt(task.content, context),
        {
          workingDir: this.workingDir,
          timeoutMinutes: task.timeoutMinutes,
          maxTurns: this.config.plannerMaxTurns,
          systemPrompt: buildPlannerSystemPrompt(),
          allowedTools: ["Read", "Glob", "Grep", "Bash"],
          abortSignal,
        },
        task.id,
        context.runId!,
        allMessages,
      );

      plan = this.parseJsonResult<ExecutionPlan>(plannerResult.result);
      lastSessionId = plannerResult.sessionId;
      totalCost += plannerResult.totalCostUsd;
      totalDuration += plannerResult.durationMs;
      totalTurns += plannerResult.numTurns;

      phases.push({
        phase: "planner",
        durationMs: plannerResult.durationMs,
        costUsd: plannerResult.totalCostUsd,
        turns: plannerResult.numTurns,
        iteration: 1,
      });
    } catch (err) {
      throw new Error(`Planner phase failed: ${err instanceof Error ? err.message : err}`);
    }

    // ─── Phases 2-4: Developer → Tester → Reviewer (with fix loop) ─
    let testResult: TestResult | undefined;
    let reviewResult: ReviewResult | undefined;
    let iteration = 0;
    const maxIterations = this.config.maxFixIterations;

    while (iteration < maxIterations) {
      iteration++;

      // Phase 2: Developer
      this.broadcastPhase(task.id, context.runId!, "developer", iteration);

      const fixFeedback = iteration > 1 && reviewResult && testResult
        ? buildFixFeedback(reviewResult, testResult)
        : undefined;

      let devResult: CCTaskResult;
      try {
        devResult = await this.executeCC(
          buildDeveloperPrompt(task.content, plan, fixFeedback),
          {
            workingDir: this.workingDir,
            timeoutMinutes: task.timeoutMinutes,
            maxTurns: this.config.developerMaxTurns,
            systemPrompt: buildDeveloperSystemPrompt(),
            allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
            abortSignal,
          },
          task.id,
          context.runId!,
          allMessages,
        );
      } catch (err) {
        // Developer failed — if we have remaining iterations, retry; else bail
        if (iteration < maxIterations) {
          continue;
        }
        throw new Error(`Developer phase failed after ${iteration} iterations: ${err instanceof Error ? err.message : err}`);
      }

      lastSessionId = devResult.sessionId;
      totalCost += devResult.totalCostUsd;
      totalDuration += devResult.durationMs;
      totalTurns += devResult.numTurns;
      phases.push({
        phase: "developer",
        durationMs: devResult.durationMs,
        costUsd: devResult.totalCostUsd,
        turns: devResult.numTurns,
        iteration,
      });

      // Get diff summary for tester and reviewer
      const diffSummary = await this.getDiffSummary();

      // Phase 3: Tester
      this.broadcastPhase(task.id, context.runId!, "tester", iteration);

      try {
        const testerResult = await this.executeCC(
          buildTesterPrompt(plan, diffSummary),
          {
            workingDir: this.workingDir,
            timeoutMinutes: task.timeoutMinutes,
            maxTurns: this.config.testerMaxTurns,
            systemPrompt: buildTesterSystemPrompt(),
            allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
            abortSignal,
          },
          task.id,
          context.runId!,
          allMessages,
        );

        testResult = this.parseJsonResult<TestResult>(testerResult.result);
        lastSessionId = testerResult.sessionId;
        totalCost += testerResult.totalCostUsd;
        totalDuration += testerResult.durationMs;
        totalTurns += testerResult.numTurns;
        phases.push({
          phase: "tester",
          durationMs: testerResult.durationMs,
          costUsd: testerResult.totalCostUsd,
          turns: testerResult.numTurns,
          iteration,
        });
      } catch (err) {
        // Tester failed — treat as tests not passing
        testResult = {
          testsWritten: [],
          allPassed: false,
          failures: [`Test execution failed: ${err instanceof Error ? err.message : err}`],
          coverage: "Testing phase failed to execute",
        };
      }

      // Phase 4: Reviewer
      this.broadcastPhase(task.id, context.runId!, "reviewer", iteration);

      try {
        const reviewerResult = await this.executeCC(
          buildReviewerPrompt(plan, diffSummary, testResult),
          {
            workingDir: this.workingDir,
            timeoutMinutes: task.timeoutMinutes,
            maxTurns: this.config.reviewerMaxTurns,
            systemPrompt: buildReviewerSystemPrompt(),
            allowedTools: ["Read", "Bash", "Glob", "Grep"],
            abortSignal,
          },
          task.id,
          context.runId!,
          allMessages,
        );

        reviewResult = this.parseJsonResult<ReviewResult>(reviewerResult.result);
        lastSessionId = reviewerResult.sessionId;
        totalCost += reviewerResult.totalCostUsd;
        totalDuration += reviewerResult.durationMs;
        totalTurns += reviewerResult.numTurns;
        phases.push({
          phase: "reviewer",
          durationMs: reviewerResult.durationMs,
          costUsd: reviewerResult.totalCostUsd,
          turns: reviewerResult.numTurns,
          iteration,
        });
      } catch (err) {
        // Reviewer failed — default to not approved
        reviewResult = {
          approved: false,
          score: 0,
          issues: [],
          summary: `Review phase failed: ${err instanceof Error ? err.message : err}`,
        };
      }

      // Check if approved
      if (reviewResult.approved) {
        break;
      }

      // Not approved — loop back to developer if iterations remain
      // (The while loop condition handles maxIterations)
    }

    // Build final output
    const finalOutput = reviewResult
      ? `Pipeline completed (${iteration} iteration${iteration > 1 ? "s" : ""}). Review: ${reviewResult.summary}`
      : "Pipeline completed without review.";

    return {
      finalOutput,
      sessionId: lastSessionId,
      totalCostUsd: totalCost,
      durationMs: totalDuration,
      numTurns: totalTurns,
      messages: allMessages,
      phases,
      iterations: iteration,
      plan,
      testResult,
      reviewResult,
    };
  }

  private async executeCC(
    prompt: string,
    options: import("../cc-integration/cc-client.js").CCExecutionOptions,
    taskId: string,
    runId: string,
    allMessages: CCMessage[],
  ): Promise<CCTaskResult> {
    const collectedMessages: CCMessage[] = [];
    let result: CCTaskResult | null = null;
    let streamResult = "";
    let streamSessionId = "";
    let streamCost = 0;
    let streamDuration = 0;
    let streamTurns = 0;

    const stream = this.ccClient.executeTaskStream(prompt, options);
    for await (const message of stream) {
      collectedMessages.push(message);
      allMessages.push(message);
      this.notify("task.stream", { taskId, runId, message });

      if (message.type === "result" && message.subtype === "success") {
        streamResult = message.result || "";
        streamSessionId = message.session_id || "";
        streamCost = message.total_cost_usd || 0;
        streamDuration = message.duration_ms || 0;
        streamTurns = message.num_turns || 0;
      }
    }

    if (streamResult) {
      result = {
        result: streamResult,
        sessionId: streamSessionId,
        totalCostUsd: streamCost,
        durationMs: streamDuration,
        numTurns: streamTurns,
        messages: collectedMessages,
      };
    } else {
      const assistantTexts = collectedMessages
        .filter((m) => m.type === "assistant")
        .map((m) => typeof m.content === "string"
          ? m.content
          : (Array.isArray(m.content) ? (m.content as Array<{text: string}>).map((c) => c.text).join("") : ""))
        .filter(Boolean);
      const fallback = assistantTexts.length > 0 ? assistantTexts[assistantTexts.length - 1] : "";
      if (fallback) {
        result = {
          result: fallback,
          sessionId: streamSessionId,
          totalCostUsd: streamCost,
          durationMs: streamDuration,
          numTurns: streamTurns,
          messages: collectedMessages,
        };
      }
    }

    if (!result || !result.result) {
      throw new Error("CC stream completed without producing a result");
    }

    return result;
  }

  private parseJsonResult<T>(text: string): T {
    let cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // Try extracting balanced JSON
    }

    const extract = (open: string, close: string): string | null => {
      const startIdx = cleaned.indexOf(open);
      if (startIdx === -1) return null;
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = startIdx; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === open) depth++;
        if (ch === close) depth--;
        if (depth === 0) {
          const candidate = cleaned.substring(startIdx, i + 1);
          try { return JSON.parse(candidate); } catch { return null; }
        }
      }
      return null;
    };

    const extracted = extract("{", "}") || extract("[", "]");
    if (extracted) {
      return JSON.parse(extracted) as T;
    }

    throw new Error(`Failed to parse JSON from: ${text.substring(0, 200)}`);
  }

  private async getDiffSummary(): Promise<string> {
    try {
      const gitManager = new GitManager({ workingDir: this.workingDir });
      const diff = await gitManager.getDiff();
      if (!diff || diff.length === 0) return "(no unstaged changes detected)";
      // Truncate to prevent overwhelming the prompt
      return diff.length > 8000 ? diff.substring(0, 8000) + "\n... (truncated)" : diff;
    } catch {
      return "(could not retrieve diff)";
    }
  }

  private broadcastPhase(taskId: string, runId: string, phase: TaskPhase, iteration: number): void {
    this.notify("task.phase", { taskId, runId, phase, iteration });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src-engine/src/engine/task-pipeline.ts
git commit -m "feat: add TaskPipeline class with 4-phase planner→developer→tester→reviewer flow"
```

---

### Task 5: Integrate TaskPipeline into Executor

**Files:**
- Modify: `src-engine/src/engine/executor.ts`

- [ ] **Step 1: Replace imports**

Remove these imports (lines 7-9):
```ts
import { BUILTIN_ROLES } from "./agent-roles.js";
import { WorkerAgent } from "./worker-agent.js";
import { WorktreeManager } from "../git/worktree-manager.js";
```

Add this import:
```ts
import { TaskPipeline, type PipelineResult } from "./task-pipeline.js";
```

- [ ] **Step 2: Remove worker/parallel fields and methods from Executor class**

Remove these fields from the class (lines 48-49):
```ts
  private activeWorkers: Map<string, WorkerAgent> = new Map();
  private worktreeManager: WorktreeManager = new WorktreeManager();
```

- [ ] **Step 3: Simplify the start() method's main loop**

Replace the entire `while (this.running)` block (lines 116-172) with:

```ts
      while (this.running) {
        const task = this.queueManager.dequeue(run.id);

        if (!task) {
          const shouldContinue = await this.handleEmptyQueue(run);
          if (!shouldContinue) break;
          continue;
        }

        this.store.updateTask(run.id, task.id, { status: "running", startedAt: Date.now() });
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "running" });
        this.broadcast("queue.updated", { runId: run.id, queue: this.queueManager.list(run.id) });

        await this.executeSingleTask(task, run);

        run.totalTasksCompleted++;
        this.store.saveRun(run);

        // Post-task budget guard
        const taskCost = this.recalculateCost(run.id);
        if (taskCost > this.config.maxBudgetUsd) {
          this.log(run.id, "engine", "warn", `Budget exceeded after task: $${taskCost.toFixed(2)} > $${this.config.maxBudgetUsd}. Stopping.`);
          this.broadcast("run.status", { runId: run.id, status: "budget_exceeded", cost: taskCost, budget: this.config.maxBudgetUsd });
          this.stop();
          await this.finalize(run, `Budget exceeded after task ($${taskCost.toFixed(2)}).`);
          break;
        }
      }
```

- [ ] **Step 4: Rewrite executeSingleTask to use TaskPipeline**

Replace the entire `executeSingleTask` method (lines 348-562) with:

```ts
  private async executeSingleTask(task: TaskDefinition, run: ExecutionRun): Promise<void> {
    const gitManager = new GitManager({ workingDir: run.workingDir });
    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);

    try {
      await gitManager.ensureInit();
      const context = await this.buildContext(task, run, gitManager);

      this.log(run.id, "pipeline", "info", `Starting pipeline: ${task.content.substring(0, 80)}...`);

      // Run the 4-phase pipeline
      const pipeline = new TaskPipeline(this.ccClient, this.broadcast.bind(this), run.workingDir);
      const pipelineResult = await pipeline.run(task, context, abortController.signal);

      this.log(run.id, "pipeline", "info",
        `Pipeline completed: ${pipelineResult.iterations} iteration(s), ${pipelineResult.phases.length} phases, $${pipelineResult.totalCostUsd.toFixed(4)}`,
        task.id);

      run.totalCostUsd = this.recalculateCost(run.id) + pipelineResult.totalCostUsd;

      this.store.updateTask(run.id, task.id, {
        status: "scoring",
        result: pipelineResult.finalOutput,
        sessionId: pipelineResult.sessionId,
        costUsd: pipelineResult.totalCostUsd,
        durationMs: pipelineResult.durationMs,
        pipelinePhases: pipelineResult.phases,
        pipelineIterations: pipelineResult.iterations,
      });
      this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "scoring" });

      // Use reviewer score if available, otherwise fall back to separate scoring
      let score: ScoreDetails;
      if (pipelineResult.reviewResult) {
        const reviewScore = pipelineResult.reviewResult.score;
        score = {
          overall: reviewScore,
          goalAlignment: reviewScore * 0.3,
          correctness: reviewScore * 0.3,
          completeness: reviewScore * 0.2,
          quality: reviewScore * 0.2,
          passed: reviewScore >= this.config.qualityThreshold,
          reasoning: pipelineResult.reviewResult.summary,
        };
      } else {
        try {
          score = await this.scoreTask(task, pipelineResult.finalOutput, run);
        } catch (scoringErr) {
          const scoringMsg = this.errorToMessage(scoringErr);
          this.log(run.id, "scorer", "warn", `Scoring failed: ${scoringMsg} — reverting to be safe`, task.id);
          score = { overall: 0, goalAlignment: 0, correctness: 0, completeness: 0, quality: 0, passed: false, reasoning: `Scoring CC failed: ${scoringMsg}` };
        }
      }

      this.store.appendScore(run.id, task.id, score);
      this.store.updateTask(run.id, task.id, { score: score.overall, scoreDetails: score });
      this.broadcast("task.scored", { taskId: task.id, runId: run.id, score });

      this.log(run.id, "scorer", score.passed ? "info" : "warn",
        `Score: ${(score.overall * 100).toFixed(0)}% — ${score.passed ? "PASS" : "FAIL (reverting)"}`, task.id);

      // ─── Checkpoint: borderline_score ─────────────────────
      const scoreDiff = Math.abs(score.overall - this.config.qualityThreshold);
      if (scoreDiff < 0.15) {
        this.log(run.id, "engine", "info", "Borderline score — requesting human decision", task.id);
        const diffStats = await this.getDiffStats(gitManager);
        const decision = await this.checkApproval(
          "borderline_score", run, task,
          "Score near threshold. Commit or revert?",
          { score, diffStats, taskContent: task.content },
        );
        if (decision?.action === "reject") {
          score.passed = false;
        } else if (decision?.action === "approve" && !score.passed) {
          score.passed = true;
        }
        if (decision?.instructions) {
          this.log(run.id, "engine", "info", "Human instruction: " + decision.instructions, task.id);
        }
      }

      // ─── Checkpoint: risky_commit ─────────────────────────
      if (score.passed) {
        const diffStats = await this.getDiffStats(gitManager);
        const isRisky = diffStats.filesChanged > 10
          || diffStats.linesChanged > 200
          || diffStats.hasCriticalFiles;
        if (isRisky) {
          this.log(run.id, "engine", "info", "Risky commit — requesting human review", task.id);
          const decision = await this.checkApproval(
            "risky_commit", run, task,
            "Large change: " + diffStats.filesChanged + " files, " + diffStats.linesChanged + " lines. Review?",
            { diffStats, taskContent: task.content },
          );
          if (decision?.action === "reject") {
            score.passed = false;
          }
          if (decision?.instructions) {
            this.log(run.id, "engine", "info", "Human instruction: " + decision.instructions, task.id);
          }
        }
      }

      if (score.passed) {
        const commitHash = await gitManager.autoCommit(task.id, task.content);
        this.log(run.id, "git", "info", `Committed: ${commitHash ? commitHash.substring(0, 7) : "unknown"} #AI commit#`, task.id);
        this.store.appendCommit(run.id, {
          taskId: task.id, runId: run.id, hash: commitHash || "", message: task.content,
          isAiCommit: true, timestamp: Date.now(), additions: 0, deletions: 0,
        });
        this.broadcast("git.commit", { taskId: task.id, runId: run.id, hash: commitHash, message: task.content, isAiCommit: true });
        this.store.updateTask(run.id, task.id, { status: "completed", completedAt: Date.now() });
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "completed" });

        // Verify features after successful commit
        if (run.features && run.features.length > 0) {
          await this.verifyFeatures(run);
        }
      } else {
        let revertSucceeded = true;
        try {
          await gitManager.checkoutClean();
          await gitManager.revert("HEAD");
          this.log(run.id, "git", "warn", "Reverted last commit (quality below threshold)", task.id);
        } catch (revertErr) {
          revertSucceeded = false;
          this.log(run.id, "git", "error", `Revert failed: ${this.errorToMessage(revertErr)}`, task.id);
        }
        this.store.appendLesson(run.id, {
          runId: run.id, taskId: task.id, category: "failure",
          lesson: `Task "${task.content.substring(0, 50)}" scored ${(score.overall * 100).toFixed(0)}%. Reason: ${score.reasoning}`,
          score: score.overall, createdAt: Date.now(),
        });
        const finalStatus: TaskStatus = revertSucceeded ? "reverted" : "failed";
        const failReason = `Score: ${(score.overall * 100).toFixed(0)}% (threshold: ${(this.config.qualityThreshold * 100).toFixed(0)}%). ${score.reasoning}${!revertSucceeded ? " | Revert also failed" : ""}`;
        this.store.updateTask(run.id, task.id, { status: finalStatus, completedAt: Date.now(), errorMessage: failReason });
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: finalStatus, reason: failReason });
      }
    } catch (err) {
      const msg = this.errorToMessage(err);
      const currentTask = this.store.getTask(run.id, task.id);
      const currentRetries = currentTask?.retryCount ?? 0;
      const maxRetries = this.config.maxAutoRetries;

      if (isTransientError(msg) && currentRetries < maxRetries) {
        const backoffMs = Math.min(30000 * Math.pow(2, currentRetries), 300000);
        this.log(run.id, "engine", "warn",
          `Transient error (retry ${currentRetries + 1}/${maxRetries}): ${msg.substring(0, 100)}. Retrying in ${backoffMs / 1000}s.`,
          task.id);
        this.store.updateTask(run.id, task.id, {
          status: "pending",
          retryCount: currentRetries + 1,
          lastError: msg.substring(0, 500),
        });
        const requeued = this.queueManager.enqueue(run.id, {
          content: task.content,
          type: task.type,
          priority: task.priority,
          timeoutMinutes: task.timeoutMinutes,
        });
        this.store.saveTask(run.id, requeued);
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "pending", reason: `Auto-retry ${currentRetries + 1}/${maxRetries}` });
        try { await this.sleep(backoffMs); } catch { /* interrupted by stop */ }
      } else {
        try {
          await gitManager.checkoutClean();
        } catch (cleanupErr) {
          this.log(run.id, "git", "warn", `Working dir cleanup failed: ${this.errorToMessage(cleanupErr)}`, task.id);
        }
        this.log(run.id, "engine", "error", `Task failed permanently: ${msg}`, task.id);
        this.store.updateTask(run.id, task.id, { status: "failed", errorMessage: msg, completedAt: Date.now() });
        this.broadcast("task.status", { taskId: task.id, runId: run.id, status: "failed", error: msg });
      }
    } finally {
      this.abortControllers.delete(task.id);
    }
  }
```

- [ ] **Step 5: Remove parallel-mode methods**

Delete the `resolveRole` method (lines 882-885).
Delete the `executeInWorker` method (lines 887-968).

- [ ] **Step 6: Simplify stop() method**

Replace the stop() method (lines 811-837) with:

```ts
  stop(): void {
    if (this.currentRun?.goalStatus === "pursuing") {
      this.currentRun.goalTimeElapsedMs = Date.now() - (this.currentRun.goalTimeStartedAt ?? Date.now());
      this.store.saveRun(this.currentRun);
    }
    this.running = false;
    this.stopController?.abort();
    this.approvalGate?.abort();
    this.approvalGate = null;
    for (const [id, controller] of this.abortControllers) {
      controller.abort();
      this.store.updateTask(this.runId, id, { status: "cancelled", completedAt: Date.now() });
    }
    this.abortControllers.clear();
  }
```

- [ ] **Step 7: Add getDiff method to GitManager**

Check if `GitManager` has a `getDiff()` method. If not, add it to `src-engine/src/git/git-manager.ts`:

```ts
  async getDiff(): Promise<string> {
    try {
      return await this.git.diff();
    } catch {
      return "";
    }
  }
```

- [ ] **Step 8: Commit**

```bash
git add src-engine/src/engine/executor.ts src-engine/src/git/git-manager.ts
git commit -m "refactor: integrate TaskPipeline into Executor, remove parallel mode"
```

---

### Task 6: Clean Up RPC Methods

**Files:**
- Modify: `src-engine/src/json-rpc/methods.ts`

- [ ] **Step 1: Remove parallel-mode RPC handlers and imports**

Remove the `run.setExecutionMode` handler (lines 766-778).
Remove the `run.setMaxConcurrent` handler (lines 780-792).
Remove the `role.list` handler (lines 794-797).
Remove the `role.create` handler (lines 799-801).

- [ ] **Step 2: Add pipeline config keys**

Add pipeline config keys to `ALLOWED_CONFIG_KEYS` (around line 114):

```ts
  "maxFixIterations",
  "plannerMaxTurns",
  "developerMaxTurns",
  "testerMaxTurns",
  "reviewerMaxTurns",
```

Add constraints for the new keys in `NUMERIC_CONFIG_CONSTRAINTS`:

```ts
  maxFixIterations: { min: 1, max: 10 },
  plannerMaxTurns: { min: 1, max: 100 },
  developerMaxTurns: { min: 1, max: 200 },
  testerMaxTurns: { min: 1, max: 100 },
  reviewerMaxTurns: { min: 1, max: 100 },
```

- [ ] **Step 3: Commit**

```bash
git add src-engine/src/json-rpc/methods.ts
git commit -m "refactor: remove parallel RPC handlers, add pipeline config keys"
```

---

### Task 7: Delete Obsolete Files

**Files:**
- Delete: `src-engine/src/engine/worker-agent.ts`
- Delete: `src-engine/src/engine/agent-roles.ts`

- [ ] **Step 1: Delete files and check for remaining references**

```bash
rm src-engine/src/engine/worker-agent.ts src-engine/src/engine/agent-roles.ts
```

Search for any remaining imports of these files:
```bash
grep -r "worker-agent\|agent-roles\|WorkerAgent\|BUILTIN_ROLES" src-engine/ shared/
```

Fix any remaining references found.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: remove obsolete worker-agent and agent-roles files"
```

---

### Task 8: Build Verification

- [ ] **Step 1: Rebuild shared package**

```bash
cd shared && npx tsc --build
```

Expected: Clean compile, no errors.

- [ ] **Step 2: Rebuild engine**

```bash
cd src-engine && npx tsc --noEmit
```

Expected: Clean compile, no type errors.

- [ ] **Step 3: Run existing tests**

```bash
cd src-engine && npx vitest run
```

Expected: All existing tests pass. Some tests may need updates if they reference `executionMode`, `parallel`, `WorkerAgent`, or `BUILTIN_ROLES`.

- [ ] **Step 4: Fix any test failures**

Update tests to remove references to deleted parallel-mode code. Tests should only exercise the pipeline path.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: update tests for pipeline mode"
```
