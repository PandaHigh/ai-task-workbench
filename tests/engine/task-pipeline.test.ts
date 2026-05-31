import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { CCMessage } from "../../src-engine/src/cc-integration/cc-client.js";
import type {
  TaskDefinition,
  TaskContext,
  ExecutionPlan,
  TestResult,
  ReviewResult,
} from "@ai-workbench/shared";

// ─── Mock setup (module scope) ─────────────────────────────────────────────

const mockExecuteTaskStream = vi.fn();

vi.mock("../../src-engine/src/cc-integration/cc-client.js", () => ({
  CCClient: vi.fn(() => ({
    executeTaskStream: mockExecuteTaskStream,
  })),
}));

const mockGetDiff = vi.fn(() => "");

vi.mock("../../src-engine/src/git/git-manager.js", () => ({
  GitManager: vi.fn(() => ({
    ensureInit: vi.fn(),
    getDiff: mockGetDiff,
  })),
}));

// Mock playwright-mcp to avoid real filesystem writes
vi.mock("../../src-engine/src/lib/playwright-mcp.js", () => ({
  ensurePlaywrightMcpConfig: vi.fn(() => "/tmp/fake-mcp.json"),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build an async generator that yields the given CC messages. */
async function* mockStream(messages: CCMessage[]): AsyncGenerator<CCMessage> {
  for (const msg of messages) {
    yield msg;
  }
}

/**
 * Build a CCMessage of type "assistant".
 * NOTE: executeCC prefers the last assistant message text over the result
 * message text. When the pipeline needs to parse JSON from the phase output
 * (planner, tester, reviewer), do NOT include assistant messages with plain
 * text -- either omit them or include one whose content is the JSON itself.
 */
function assistantMessage(content: string): CCMessage {
  return { type: "assistant", content };
}

/** Build a CCMessage of type "result" with subtype "success". */
function resultMessage(result: string, overrides?: Partial<CCMessage>): CCMessage {
  return {
    type: "result",
    subtype: "success",
    result,
    session_id: "session-1",
    total_cost_usd: 0.01,
    duration_ms: 1000,
    num_turns: 3,
    ...overrides,
  };
}

/** Build a CCMessage of type "tool_use" for progress parsing. */
function toolUseMessage(name: string): CCMessage {
  return { type: "tool_use", name } as CCMessage;
}

/** Create a minimal valid task definition. */
function makeTask(overrides?: Partial<TaskDefinition>): TaskDefinition {
  return {
    id: "task-abc123",
    runId: "run-1",
    type: "user_defined",
    priority: 1,
    content: "Implement feature X",
    timeoutMinutes: 10,
    promptJson: "",
    status: "pending",
    createdAt: Date.now(),
    ...overrides,
  };
}

/** Create a minimal valid task context. */
function makeContext(overrides?: Partial<TaskContext>): TaskContext {
  return {
    workingDir: "/tmp/test-project",
    goals: ["Build feature X"],
    terminationConditions: [],
    lastTenCommits: [],
    nextFiveTasks: [],
    lessonsLearned: [],
    ...overrides,
  };
}

const VALID_PLAN: ExecutionPlan = {
  understanding: "User wants feature X implemented",
  steps: ["Step 1: Create module", "Step 2: Add tests"],
  targetFiles: ["src/feature.ts"],
  risks: ["May break existing API"],
  testStrategy: "Unit tests with vitest",
};

const VALID_TEST_RESULT: TestResult = {
  testsWritten: ["feature.test.ts"],
  allPassed: true,
  failures: [],
  coverage: "80%",
};

const VALID_REVIEW_RESULT: ReviewResult = {
  approved: true,
  score: 0.85,
  issues: [],
  summary: "Code looks good",
};

/**
 * Helper: set up the standard 4-phase mock streams (planner, developer, tester, reviewer).
 * For JSON phases (planner, tester, reviewer), we use only result messages without
 * assistant messages so executeCC picks up the JSON from streamResult.
 */
function setupStandardPipelineMocks(
  planOverrides?: Partial<ExecutionPlan>,
  testOverrides?: Partial<TestResult>,
  reviewOverrides?: Partial<ReviewResult>,
) {
  const plan = { ...VALID_PLAN, ...planOverrides };
  const test = { ...VALID_TEST_RESULT, ...testOverrides };
  const review = { ...VALID_REVIEW_RESULT, ...reviewOverrides };

  mockExecuteTaskStream
    // Planner
    .mockImplementationOnce(() =>
      mockStream([resultMessage(JSON.stringify(plan))]),
    )
    // Developer
    .mockImplementationOnce(() =>
      mockStream([resultMessage("Code written")]),
    )
    // Tester
    .mockImplementationOnce(() =>
      mockStream([resultMessage(JSON.stringify(test))]),
    )
    // Reviewer
    .mockImplementationOnce(() =>
      mockStream([resultMessage(JSON.stringify(review))]),
    );
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("TaskPipeline", () => {
  let notifications: { method: string; params: Record<string, unknown> }[];
  let notify: (method: string, params: Record<string, unknown>) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    notifications = [];
    notify = (method, params) => notifications.push({ method, params });
    mockGetDiff.mockResolvedValue("diff --git a/file.ts b/file.ts\n+new line");
  });

  async function createPipeline(config?: Record<string, unknown>) {
    const { TaskPipeline } = await import(
      "../../src-engine/src/engine/task-pipeline.js"
    );
    const { CCClient } = await import(
      "../../src-engine/src/cc-integration/cc-client.js"
    );
    const cc = new CCClient("claude");
    return new TaskPipeline(
      cc,
      notify,
      "/tmp/test-project",
      config as Parameters<typeof TaskPipeline>[3],
    );
  }

  // ────────────────────────────────────────────────────────────────────────

  it("Planner phase: CC returns valid JSON plan, passed to Developer", async () => {
    const pipeline = await createPipeline();

    const planJson = JSON.stringify(VALID_PLAN);
    // Capture the developer prompt to verify plan was passed through
    let developerPrompt: string | null = null;

    mockExecuteTaskStream
      // Planner call — no assistant message, so executeCC uses streamResult (the JSON)
      .mockImplementationOnce(() =>
        mockStream([resultMessage(planJson, { session_id: "planner-sess" })]),
      )
      // Developer call
      .mockImplementationOnce((prompt: string) => {
        developerPrompt = prompt;
        return mockStream([resultMessage("Code written")]);
      })
      // Tester call
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_TEST_RESULT))]),
      )
      // Reviewer call
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_REVIEW_RESULT))]),
      );

    const result = await pipeline.run(makeTask(), makeContext());

    // Verify plan was parsed
    expect(result.plan).toBeDefined();
    expect(result.plan!.understanding).toBe("User wants feature X implemented");
    expect(result.plan!.steps).toHaveLength(2);
    expect(result.plan!.targetFiles).toContain("src/feature.ts");

    // Verify plan was passed to developer prompt
    expect(developerPrompt).toContain("feature X implemented");
    expect(developerPrompt).toContain("Step 1: Create module");
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Developer phase: CC executes code and returns result", async () => {
    const pipeline = await createPipeline();

    mockExecuteTaskStream
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_PLAN))]),
      )
      .mockImplementationOnce(() =>
        mockStream([
          toolUseMessage("Write"),
          // Assistant message preferred by executeCC for developer result — that is fine,
          // developer result is plain text, not parsed as JSON
          assistantMessage("Feature implemented successfully"),
          resultMessage("Feature implemented successfully", {
            total_cost_usd: 0.05,
            duration_ms: 5000,
            num_turns: 8,
          }),
        ]),
      )
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_TEST_RESULT))]),
      )
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_REVIEW_RESULT))]),
      );

    const result = await pipeline.run(makeTask(), makeContext());

    const devPhase = result.phases.find((p) => p.phase === "developer");
    expect(devPhase).toBeDefined();
    expect(devPhase!.durationMs).toBe(5000);
    expect(devPhase!.costUsd).toBeCloseTo(0.05);
    expect(devPhase!.turns).toBe(8);
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Tester phase: CC returns tests passed", async () => {
    const pipeline = await createPipeline();

    mockExecuteTaskStream
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_PLAN))]),
      )
      .mockImplementationOnce(() =>
        mockStream([resultMessage("Code written")]),
      )
      .mockImplementationOnce(() =>
        mockStream([
          resultMessage(JSON.stringify(VALID_TEST_RESULT), {
            session_id: "tester-sess",
            total_cost_usd: 0.02,
            duration_ms: 3000,
          }),
        ]),
      )
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_REVIEW_RESULT))]),
      );

    const result = await pipeline.run(makeTask(), makeContext());

    expect(result.testResult).toBeDefined();
    expect(result.testResult!.allPassed).toBe(true);
    expect(result.testResult!.testsWritten).toContain("feature.test.ts");

    const testerPhase = result.phases.find((p) => p.phase === "tester");
    expect(testerPhase).toBeDefined();
    expect(testerPhase!.costUsd).toBeCloseTo(0.02);
    expect(testerPhase!.durationMs).toBe(3000);
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Reviewer phase: CC returns code review approved", async () => {
    const pipeline = await createPipeline();

    mockExecuteTaskStream
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_PLAN))]),
      )
      .mockImplementationOnce(() =>
        mockStream([resultMessage("Code written")]),
      )
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_TEST_RESULT))]),
      )
      .mockImplementationOnce(() =>
        mockStream([
          resultMessage(JSON.stringify(VALID_REVIEW_RESULT), {
            session_id: "reviewer-sess",
          }),
        ]),
      );

    const result = await pipeline.run(makeTask(), makeContext());

    expect(result.reviewResult).toBeDefined();
    expect(result.reviewResult!.approved).toBe(true);
    expect(result.reviewResult!.score).toBeCloseTo(0.85);
    expect(result.reviewResult!.summary).toBe("Code looks good");

    const reviewerPhase = result.phases.find((p) => p.phase === "reviewer");
    expect(reviewerPhase).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Tester failure triggers fix loop (Developer called again)", async () => {
    const pipeline = await createPipeline({ maxFixIterations: 3 });

    const failedTestResult: TestResult = {
      testsWritten: ["feature.test.ts"],
      allPassed: false,
      failures: ["Expected true, received false"],
      coverage: "40%",
    };

    const rejectedReviewResult: ReviewResult = {
      approved: false,
      score: 0.3,
      issues: [
        {
          severity: "major",
          file: "src/feature.ts",
          line: 10,
          description: "Logic error",
          suggestion: "Fix the condition",
        },
      ],
      summary: "Tests failing, needs fix",
    };

    mockExecuteTaskStream
      // Iteration 1: Planner
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_PLAN))]),
      )
      // Iteration 1: Developer
      .mockImplementationOnce(() =>
        mockStream([resultMessage("Initial implementation")]),
      )
      // Iteration 1: Tester (fails)
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(failedTestResult))]),
      )
      // Iteration 1: Reviewer (rejects)
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(rejectedReviewResult))]),
      )
      // Iteration 2: Developer (fix attempt)
      .mockImplementationOnce(() =>
        mockStream([resultMessage("Fixed the issue")]),
      )
      // Iteration 2: Tester (passes now)
      .mockImplementationOnce(() =>
        mockStream([
          resultMessage(JSON.stringify({ ...VALID_TEST_RESULT, allPassed: true })),
        ]),
      )
      // Iteration 2: Reviewer (approves)
      .mockImplementationOnce(() =>
        mockStream([
          resultMessage(JSON.stringify({ ...VALID_REVIEW_RESULT, score: 0.9 })),
        ]),
      );

    const result = await pipeline.run(makeTask(), makeContext());

    // Developer was called twice (iteration 1 + fix in iteration 2)
    const devPhases = result.phases.filter((p) => p.phase === "developer");
    expect(devPhases).toHaveLength(2);
    expect(devPhases[0].iteration).toBe(1);
    expect(devPhases[1].iteration).toBe(2);

    // Tester was called twice
    const testerPhases = result.phases.filter((p) => p.phase === "tester");
    expect(testerPhases).toHaveLength(2);

    // Reviewer was called twice
    const reviewerPhases = result.phases.filter((p) => p.phase === "reviewer");
    expect(reviewerPhases).toHaveLength(2);

    expect(result.iterations).toBe(2);
    expect(result.reviewResult!.approved).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Full pipeline success: all 4 phases, correct PipelineResult", async () => {
    const pipeline = await createPipeline();

    mockExecuteTaskStream
      .mockImplementationOnce(() =>
        mockStream([
          resultMessage(JSON.stringify(VALID_PLAN), {
            session_id: "plan-sess",
            total_cost_usd: 0.01,
            duration_ms: 2000,
            num_turns: 5,
          }),
        ]),
      )
      .mockImplementationOnce(() =>
        mockStream([
          assistantMessage("Coding..."),
          resultMessage("Code done", {
            session_id: "dev-sess",
            total_cost_usd: 0.05,
            duration_ms: 8000,
            num_turns: 12,
          }),
        ]),
      )
      .mockImplementationOnce(() =>
        mockStream([
          resultMessage(JSON.stringify(VALID_TEST_RESULT), {
            session_id: "test-sess",
            total_cost_usd: 0.02,
            duration_ms: 4000,
            num_turns: 6,
          }),
        ]),
      )
      .mockImplementationOnce(() =>
        mockStream([
          resultMessage(JSON.stringify(VALID_REVIEW_RESULT), {
            session_id: "review-sess",
            total_cost_usd: 0.01,
            duration_ms: 2000,
            num_turns: 4,
          }),
        ]),
      );

    const result = await pipeline.run(makeTask(), makeContext());

    // Final output contains review summary
    expect(result.finalOutput).toContain("Pipeline completed (1 iteration");
    expect(result.finalOutput).toContain("Code looks good");

    // Session ID from last phase
    expect(result.sessionId).toBe("review-sess");

    // Costs and durations accumulated
    expect(result.totalCostUsd).toBeCloseTo(0.01 + 0.05 + 0.02 + 0.01);
    expect(result.durationMs).toBe(2000 + 8000 + 4000 + 2000);
    expect(result.numTurns).toBe(5 + 12 + 6 + 4);

    // All phases recorded
    expect(result.phases).toHaveLength(4);
    expect(result.phases.map((p) => p.phase)).toEqual([
      "planner",
      "developer",
      "tester",
      "reviewer",
    ]);

    // Plan, test, review results
    expect(result.plan).toEqual(VALID_PLAN);
    expect(result.testResult).toEqual(VALID_TEST_RESULT);
    expect(result.reviewResult).toEqual(VALID_REVIEW_RESULT);

    expect(result.iterations).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────────

  it("CC execution aborted via AbortSignal", async () => {
    const pipeline = await createPipeline();

    const controller = new AbortController();

    // Planner stream starts but yields no result message (simulates abort)
    mockExecuteTaskStream.mockImplementationOnce(() => {
      return (async function* () {
        yield assistantMessage("Starting...");
        // No result message -- executeCC will throw
      })();
    });

    await expect(
      pipeline.run(makeTask(), makeContext(), controller.signal),
    ).rejects.toThrow();
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Diff summary is fetched via GitManager.getDiff", async () => {
    const pipeline = await createPipeline();

    const diffContent =
      "diff --git a/feature.ts b/feature.ts\n+export function X() {}";
    mockGetDiff.mockResolvedValueOnce(diffContent);

    setupStandardPipelineMocks();

    await pipeline.run(makeTask(), makeContext());

    // getDiff should have been called once (after developer phase, before tester)
    expect(mockGetDiff).toHaveBeenCalledTimes(1);
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Diff summary is truncated when exceeding 8000 chars", async () => {
    const pipeline = await createPipeline();

    const longDiff = "x".repeat(9000);
    mockGetDiff.mockResolvedValueOnce(longDiff);

    // Capture prompts sent to tester and reviewer to verify truncation
    let testerPrompt = "";
    let reviewerPrompt = "";

    mockExecuteTaskStream
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_PLAN))]),
      )
      .mockImplementationOnce(() =>
        mockStream([resultMessage("Code written")]),
      )
      .mockImplementationOnce((prompt: string) => {
        testerPrompt = prompt;
        return mockStream([resultMessage(JSON.stringify(VALID_TEST_RESULT))]);
      })
      .mockImplementationOnce((prompt: string) => {
        reviewerPrompt = prompt;
        return mockStream([resultMessage(JSON.stringify(VALID_REVIEW_RESULT))]);
      });

    await pipeline.run(makeTask(), makeContext());

    // The diff should appear truncated in the tester prompt
    expect(testerPrompt).toContain("... (truncated)");
    // And also in the reviewer prompt
    expect(reviewerPrompt).toContain("... (truncated)");
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Progress parsing: tool_use and assistant messages emit agent.progress", async () => {
    const pipeline = await createPipeline();

    // For JSON phases we must not include assistant messages with non-JSON content.
    // For developer (plain text), assistant messages are fine.
    mockExecuteTaskStream
      .mockImplementationOnce(() =>
        mockStream([
          toolUseMessage("Read"),
          toolUseMessage("Glob"),
          resultMessage(JSON.stringify(VALID_PLAN)),
        ]),
      )
      .mockImplementationOnce(() =>
        mockStream([
          toolUseMessage("Write"),
          toolUseMessage("Edit"),
          assistantMessage("Coding..."),
          resultMessage("Code done"),
        ]),
      )
      .mockImplementationOnce(() =>
        mockStream([
          toolUseMessage("Bash"),
          resultMessage(JSON.stringify(VALID_TEST_RESULT)),
        ]),
      )
      .mockImplementationOnce(() =>
        mockStream([
          resultMessage(JSON.stringify(VALID_REVIEW_RESULT)),
        ]),
      );

    await pipeline.run(makeTask(), makeContext());

    const progressNotifications = notifications.filter(
      (n) => n.method === "agent.progress",
    );
    expect(progressNotifications.length).toBeGreaterThan(0);

    // Verify specific phase labels
    const phases = progressNotifications.map(
      (n) => (n.params as Record<string, unknown>).phase,
    );
    expect(phases).toContain("分析代码"); // Read/Glob
    expect(phases).toContain("编写代码"); // Write/Edit
    expect(phases).toContain("执行命令"); // Bash
    expect(phases).toContain("思考中"); // assistant
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Phase broadcast notifications are emitted", async () => {
    const pipeline = await createPipeline();

    setupStandardPipelineMocks();

    await pipeline.run(makeTask(), makeContext());

    const phaseNotifications = notifications.filter(
      (n) => n.method === "task.phase",
    );

    // Should have 4 phase broadcasts (planner, developer, tester, reviewer)
    const phaseNames = phaseNotifications.map(
      (n) => (n.params as Record<string, unknown>).phase,
    );
    expect(phaseNames).toEqual(["planner", "developer", "tester", "reviewer"]);

    // All should reference the correct task id
    for (const n of phaseNotifications) {
      expect((n.params as Record<string, unknown>).taskId).toBe("task-abc123");
    }
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Planner phase failure throws TaskError", async () => {
    const pipeline = await createPipeline();

    // Planner returns an assistant message with non-JSON content.
    // Since assistant text is preferred over streamResult, the pipeline
    // will try to parse the assistant text as JSON and fail.
    mockExecuteTaskStream.mockImplementationOnce(() =>
      mockStream([
        assistantMessage("I cannot create a plan for this."),
        resultMessage("Sorry, I cannot help with that."),
      ]),
    );

    await expect(pipeline.run(makeTask(), makeContext())).rejects.toThrow(
      /Planner phase failed/,
    );
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Stream messages are forwarded via task.stream notifications", async () => {
    const pipeline = await createPipeline();

    mockExecuteTaskStream
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_PLAN))]),
      )
      .mockImplementationOnce(() =>
        mockStream([resultMessage("Code written")]),
      )
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_TEST_RESULT))]),
      )
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_REVIEW_RESULT))]),
      );

    await pipeline.run(makeTask(), makeContext());

    const streamNotifications = notifications.filter(
      (n) => n.method === "task.stream",
    );

    // Each yielded CCMessage should produce a task.stream notification
    // Total: 1 (planner) + 1 (dev) + 1 (tester) + 1 (reviewer) = 4
    expect(streamNotifications.length).toBe(4);

    // Each notification carries the taskId
    for (const n of streamNotifications) {
      expect((n.params as Record<string, unknown>).taskId).toBe("task-abc123");
    }
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Tester error produces fallback TestResult with allPassed=false", async () => {
    const pipeline = await createPipeline();

    mockExecuteTaskStream
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_PLAN))]),
      )
      // Developer succeeds
      .mockImplementationOnce(() =>
        mockStream([resultMessage("Code written")]),
      )
      // Tester: assistant message with non-JSON content causes executeCC to
      // return "Tests crashed" as the result. The pipeline catches the JSON
      // parse error and creates a fallback TestResult.
      .mockImplementationOnce(() =>
        mockStream([
          assistantMessage("Tests crashed"),
          resultMessage("Tests crashed"),
        ]),
      )
      // Reviewer still runs
      .mockImplementationOnce(() =>
        mockStream([resultMessage(JSON.stringify(VALID_REVIEW_RESULT))]),
      );

    const result = await pipeline.run(makeTask(), makeContext());

    // Should have a fallback test result
    expect(result.testResult).toBeDefined();
    expect(result.testResult!.allPassed).toBe(false);
    expect(result.testResult!.failures.length).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Max fix iterations respected when review keeps rejecting", async () => {
    const maxFix = 2;
    const pipeline = await createPipeline({ maxFixIterations: maxFix });

    const rejectedReview: ReviewResult = {
      approved: false,
      score: 0.2,
      issues: [],
      summary: "Not good enough",
    };

    const planStream = () =>
      mockStream([resultMessage(JSON.stringify(VALID_PLAN))]);
    const devStream = () =>
      mockStream([resultMessage("Attempted fix")]);
    const testStream = () =>
      mockStream([resultMessage(JSON.stringify(VALID_TEST_RESULT))]);
    const reviewStream = () =>
      mockStream([resultMessage(JSON.stringify(rejectedReview))]);

    // iteration 1: planner + dev + test + review
    // iteration 2: dev + test + review (maxFix=2 reached)
    mockExecuteTaskStream
      .mockImplementationOnce(planStream)
      .mockImplementationOnce(devStream)
      .mockImplementationOnce(testStream)
      .mockImplementationOnce(reviewStream)
      .mockImplementationOnce(devStream)
      .mockImplementationOnce(testStream)
      .mockImplementationOnce(reviewStream);

    const result = await pipeline.run(makeTask(), makeContext());

    // Should have run exactly maxFix iterations
    expect(result.iterations).toBe(maxFix);

    // Developer called once per iteration
    const devPhases = result.phases.filter((p) => p.phase === "developer");
    expect(devPhases).toHaveLength(maxFix);

    // Final review should still be rejected
    expect(result.reviewResult!.approved).toBe(false);

    // Final output reflects iteration count
    expect(result.finalOutput).toContain(`${maxFix} iterations`);
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Diff retrieval failure does not crash pipeline", async () => {
    const pipeline = await createPipeline();

    mockGetDiff.mockRejectedValueOnce(new Error("git not found"));

    setupStandardPipelineMocks();

    // Should not throw despite diff failure
    const result = await pipeline.run(makeTask(), makeContext());
    expect(result.phases).toHaveLength(4);
  });

  // ────────────────────────────────────────────────────────────────────────

  it("Custom config overrides are applied", async () => {
    const pipeline = await createPipeline({
      maxFixIterations: 1,
      plannerMaxTurns: 5,
      developerMaxTurns: 10,
    });

    setupStandardPipelineMocks();

    const result = await pipeline.run(makeTask(), makeContext());

    // With maxFixIterations=1, only one iteration should happen
    expect(result.iterations).toBe(1);
  });
});
