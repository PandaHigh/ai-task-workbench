import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src-engine/src/cc-integration/cc-client.js", () => ({
  CCClient: vi.fn(() => ({
    executeTask: vi.fn().mockResolvedValue({
      result: "---TASK_SUMMARY---\n内容: 测试任务\n目标:\n- 完成功能\n终止条件:\n- 测试通过\n完成后动作: 无\n---END_SUMMARY---",
      sessionId: "sess-1",
      totalCostUsd: 0,
      durationMs: 100,
      numTurns: 1,
      messages: [],
    }),
  })),
}));

describe("Wizard Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should start a session", async () => {
    const { startSession } = await import("../../src-engine/src/wizard/wizard-handler.js");
    const session = startSession("/tmp/project");
    expect(session.sessionId).toBeDefined();
    expect(session.workingDir).toBe("/tmp/project");
    expect(session.messages).toHaveLength(0);
  });

  it("should return fallback defaults when no summary in messages", async () => {
    const { extractParams, startSession } = await import("../../src-engine/src/wizard/wizard-handler.js");
    const session = startSession("/tmp/project");
    const params = extractParams(session.sessionId);
    // No messages → returns defaults, not null
    expect(params).toBeDefined();
    expect(params!.content).toBe("未命名任务");
    expect(params!.goals).toContain("完成用户描述的任务");
  });

  it("should validate params correctly", async () => {
    const { validateParams } = await import("../../src-engine/src/wizard/wizard-handler.js");
    const valid = validateParams({
      content: "Test task",
      goals: ["goal 1"],
      terminationConditions: ["condition 1"],
      postCompletionAction: "none",
    });
    expect(valid.valid).toBe(true);
    expect(valid.errors).toHaveLength(0);
  });

  it("should reject empty content", async () => {
    const { validateParams } = await import("../../src-engine/src/wizard/wizard-handler.js");
    const valid = validateParams({
      content: "",
      goals: ["goal"],
      terminationConditions: ["cond"],
      postCompletionAction: "none",
    });
    expect(valid.valid).toBe(false);
    expect(valid.errors).toContain("任务内容不能为空");
  });

  it("should reject missing goals", async () => {
    const { validateParams } = await import("../../src-engine/src/wizard/wizard-handler.js");
    const valid = validateParams({
      content: "Test",
      goals: [],
      terminationConditions: ["cond"],
      postCompletionAction: "none",
    });
    expect(valid.valid).toBe(false);
    expect(valid.errors).toContain("至少需要一个目标");
  });

  it("should reject missing termination conditions", async () => {
    const { validateParams } = await import("../../src-engine/src/wizard/wizard-handler.js");
    const valid = validateParams({
      content: "Test",
      goals: ["goal"],
      terminationConditions: [],
      postCompletionAction: "none",
    });
    expect(valid.valid).toBe(false);
    expect(valid.errors).toContain("至少需要一个终止条件");
  });

  it("should reject null params", async () => {
    const { validateParams } = await import("../../src-engine/src/wizard/wizard-handler.js");
    const valid = validateParams(null);
    expect(valid.valid).toBe(false);
  });

  it("should parse a valid TASK_SUMMARY", async () => {
    const { startSession, chat, extractParams } = await import("../../src-engine/src/wizard/wizard-handler.js");
    const session = startSession("/tmp/project");
    // Simulate a chat that returns a summary
    await chat(session.sessionId, "帮我创建一个任务");
    const params = extractParams(session.sessionId);
    expect(params).toBeDefined();
    expect(params!.content).toBe("测试任务");
    expect(params!.goals).toContain("完成功能");
    expect(params!.terminationConditions).toContain("测试通过");
  });

  it("should handle chat with nonexistent session", async () => {
    const { chat } = await import("../../src-engine/src/wizard/wizard-handler.js");
    await expect(chat("nonexistent", "hello")).rejects.toThrow("not found");
  });

  it("should extract fallback params from conversation without summary", async () => {
    const { startSession, extractParams } = await import("../../src-engine/src/wizard/wizard-handler.js");
    const session = startSession("/tmp/project");
    // Manually add messages without TASK_SUMMARY
    session.messages.push({ role: "user", content: "my task content" });
    session.messages.push({ role: "assistant", content: "what are the goals?" });
    session.messages.push({ role: "user", content: "my goal description" });
    session.messages.push({ role: "assistant", content: "what are termination conditions?" });
    session.messages.push({ role: "user", content: "my termination condition" });

    const params = extractParams(session.sessionId);
    expect(params).toBeDefined();
    expect(params!.content).toBe("my task content");
    expect(params!.goals).toEqual(["my goal description"]);
    expect(params!.terminationConditions).toEqual(["my termination condition"]);
  });
});
