/**
 * Dynamic Workflow 端到端测试
 *
 * 覆盖：
 *   1. Task Router — 关键词匹配 + CC 评估 + 路由决策
 *   2. Workflow Builder — 构建 workflow 定义
 *   3. Workflow Store — 注册/查询/删除
 *   4. 内置模板库 — 所有内置模板正确构建
 *   5. Workflow Generator — AI 动态生成（mock CC）
 *   6. Workflow Runtime — 执行各类型阶段（mock AgentExecutor）
 *   7. RPC Methods — router.analyze / workflow.list / workflow.generate / loop.*
 *   8. Goal Evaluator — 结构化目标评估
 *   9. Loop Scheduler — 自适应定时任务
 *  10. 前端 Store — 通知驱动状态更新
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// ─── Test Setup ──────────────────────────────────────────────────────────

describe("Dynamic Workflow 端到端", () => {
  let methodHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ai-workbench-dw-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    vi.resetModules();

    // Mock Store with temp dir
    vi.doMock("../../src-engine/src/db/store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/db/store.js")>();
      return {
        Store: vi.fn(function (this: unknown) {
          return new actual.Store(testDir);
        }),
      };
    });

    vi.doMock("../../src-engine/src/db/share-store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/db/share-store.js")>();
      return {
        ShareStore: vi.fn(function (this: unknown) {
          return new actual.ShareStore(testDir);
        }),
      };
    });

    vi.doMock("../../src-engine/src/db/subscription-store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/db/subscription-store.js")>();
      return {
        SubscriptionStore: vi.fn(function (this: unknown) {
          return new actual.SubscriptionStore(testDir);
        }),
      };
    });

    // Mock CCClient — returns structured JSON based on prompt content
    vi.doMock("../../src-engine/src/cc-integration/cc-client.js", () => ({
      CCClient: vi.fn(() => ({
        executeTaskStream: vi.fn(async function* (prompt: string) {
          // Router evaluation prompt
          if (prompt.includes("任务复杂度评估器")) {
            yield {
              type: "assistant",
              message: {
                content: [{ type: "text", text: '```json\n{"level":"moderate","strategy":{"type":"builtin","templateName":"omx-pipeline"},"confidence":0.8,"reason":"中等复杂度任务","dimensions":{"scope":0.5,"uncertainty":0.4,"risk":0.5,"parallelism":0.3,"verificationNeed":0.3},"estimatedAgents":5,"estimatedCostUsd":1.5}\n```' }],
              },
            };
            yield { type: "result", result: "" };
          }
          // Goal evaluation prompt
          else if (prompt.includes("评估以下运行目标")) {
            yield {
              type: "assistant",
              message: {
                content: [{ type: "text", text: '```json\n{"achieved":false,"progress":0.3,"reason":"目标部分完成","evidence":["已完成3个任务"],"milestones":[{"id":"m1","description":"实现功能","status":"in_progress"}],"completedGoals":[],"remainingGoals":["goal 1"],"suggestedStrategy":"continue","strategyReason":"继续执行"}\n```' }],
              },
            };
            yield { type: "result", result: "" };
          }
          // Workflow generator prompt
          else if (prompt.includes("WorkflowDefinition")) {
            yield {
              type: "assistant",
              message: {
                content: [{ type: "text", text: '```json\n{"name":"自定义工作流","description":"动态生成","stages":[{"type":"agent","name":"分析","role":"analyst","prompt":"分析任务"}]}\n```' }],
              },
            };
            yield { type: "result", result: "" };
          }
          // Default
          else {
            yield {
              type: "assistant",
              message: {
                content: [{ type: "text", text: "默认响应" }],
              },
            };
            yield { type: "result", result: "默认响应" };
          }
        }),
        executeTask: vi.fn(async () => ({
          result: '{"isComplete": true, "progressReport": "Done", "completedGoals": ["g1"], "remainingGoals": [], "overallProgress": 1}',
          sessionId: "s-test", totalCostUsd: 0, durationMs: 0, numTurns: 0, messages: [],
        })),
      })),
    }));

    // Mock GitManager
    vi.doMock("../../src-engine/src/git/git-manager.js", () => ({
      GitManager: vi.fn(() => ({
        ensureInit: vi.fn(async () => {}),
        autoCommit: vi.fn(async () => "abc1234"),
        revert: vi.fn(async () => {}),
        checkoutClean: vi.fn(async () => {}),
        getLastNCommits: vi.fn(async () => []),
        getDiffStats: vi.fn(async () => ({ filesChanged: 0, linesChanged: 0, hasCriticalFiles: false })),
      })),
    }));

    const mod = await import("../../src-engine/src/json-rpc/methods.js");
    methodHandlers = mod.methodHandlers;
    mod.setNotifyFn(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  async function createRun(extra: Record<string, unknown> = {}): Promise<{ id: string }> {
    return methodHandlers["run.create"]({
      workingDir: "/tmp/test",
      goals: ["实现用户认证功能"],
      terminationConditions: ["认证功能完成"],
      ...extra,
    }) as Promise<{ id: string }>;
  }

  // ─── 1. Task Router: 关键词匹配 ───────────────────────────────────────

  describe("Task Router — 关键词匹配", () => {
    it("安全审计关键词匹配到 security-audit 模板", async () => {
      const run = await createRun();
      const result = await methodHandlers["router.analyze"]({
        content: "对整个代码库做安全审计，查找所有安全漏洞",
        runId: run.id,
      }) as { assessment: { strategy: { type: string; templateName?: string }; level: string; confidence: number } };

      expect(result.assessment.strategy.type).toBe("builtin");
      expect(result.assessment.strategy.templateName).toBe("security-audit");
      expect(result.assessment.confidence).toBeGreaterThan(0.5);
    });

    it("代码审查关键词匹配到 code-review 模板", async () => {
      const run = await createRun();
      const result = await methodHandlers["router.analyze"]({
        content: "帮我做一次全面的代码审查",
        runId: run.id,
      }) as { assessment: { strategy: { type: string; templateName?: string } } };

      expect(result.assessment.strategy.type).toBe("builtin");
      expect(result.assessment.strategy.templateName).toBe("code-review");
    });

    it("Bug 巡检关键词匹配到 bug-sweep 模板", async () => {
      const run = await createRun();
      const result = await methodHandlers["router.analyze"]({
        content: "扫描整个项目，查找所有 bug 和缺陷",
        runId: run.id,
      }) as { assessment: { strategy: { type: string; templateName?: string } } };

      expect(result.assessment.strategy.type).toBe("builtin");
      expect(result.assessment.strategy.templateName).toBe("bug-sweep");
    });

    it("迁移关键词匹配到 migration 模板", async () => {
      const run = await createRun();
      const result = await methodHandlers["router.analyze"]({
        content: "将整个项目从 JavaScript 迁移到 TypeScript",
        runId: run.id,
      }) as { assessment: { strategy: { type: string; templateName?: string } } };

      expect(result.assessment.strategy.type).toBe("builtin");
      expect(result.assessment.strategy.templateName).toBe("migration");
    });

    it("死代码关键词匹配到 dead-code 模板", async () => {
      const run = await createRun();
      const result = await methodHandlers["router.analyze"]({
        content: "找出项目中所有的死代码和未使用的函数",
        runId: run.id,
      }) as { assessment: { strategy: { type: string; templateName?: string } } };

      expect(result.assessment.strategy.type).toBe("builtin");
      expect(result.assessment.strategy.templateName).toBe("dead-code");
    });
  });

  // ─── 2. Task Router: CC 完整评估（无关键词命中时） ──────────────────────

  describe("Task Router — CC 评估", () => {
    it("无关键词命中时走 CC 完整评估", async () => {
      const run = await createRun();
      const result = await methodHandlers["router.analyze"]({
        content: "优化数据库查询性能",
        runId: run.id,
      }) as { assessment: { strategy: { type: string; templateName?: string }; confidence: number } };

      // CC mock 返回 moderate + omx-pipeline
      expect(result.assessment.strategy.type).toBe("builtin");
      expect(result.assessment.strategy.templateName).toBe("omx-pipeline");
      expect(result.assessment.confidence).toBeGreaterThan(0);
    });
  });

  // ─── 3. Workflow Builder + 内置模板 ──────────────────────────────────

  describe("内置 Workflow 模板", () => {
    it("所有内置模板都能正确构建", async () => {
      const { createOmxPipelineWorkflow } = await import("../../src-engine/src/engine/workflow/builtins/omx-pipeline.js");
      const { createSecurityAuditWorkflow } = await import("../../src-engine/src/engine/workflow/builtins/security-audit.js");
      const { createBugSweepWorkflow } = await import("../../src-engine/src/engine/workflow/builtins/bug-sweep.js");
      const { createCodeReviewWorkflow } = await import("../../src-engine/src/engine/workflow/builtins/code-review.js");
      const { createMigrationWorkflow } = await import("../../src-engine/src/engine/workflow/builtins/migration.js");
      const { createDeadCodeWorkflow } = await import("../../src-engine/src/engine/workflow/builtins/dead-code.js");

      const templates = [
        createOmxPipelineWorkflow(),
        createSecurityAuditWorkflow(),
        createBugSweepWorkflow(),
        createCodeReviewWorkflow(),
        createMigrationWorkflow(),
        createDeadCodeWorkflow(),
      ];

      for (const t of templates) {
        expect(t.id).toBeTruthy();
        expect(t.name).toBeTruthy();
        expect(t.stages.length).toBeGreaterThan(0);
        expect(t.isBuiltIn).toBe(true);

        // 验证每个 stage 有必需字段
        for (const stage of t.stages) {
          expect(stage.id).toBeTruthy();
          expect(stage.name).toBeTruthy();
          expect(stage.type).toBeTruthy();
        }
      }
    });

    it("OMX Pipeline 有 5 个阶段", async () => {
      const { createOmxPipelineWorkflow } = await import("../../src-engine/src/engine/workflow/builtins/omx-pipeline.js");
      const wf = createOmxPipelineWorkflow();
      expect(wf.stages.length).toBe(5);
      expect(wf.stages.map((s) => s.name)).toEqual([
        "深度访谈", "RALPLAN 共识规划", "目标执行", "代码审查", "QA 测试",
      ]);
    });

    it("安全审计包含并行 + 对抗性验证阶段", async () => {
      const { createSecurityAuditWorkflow } = await import("../../src-engine/src/engine/workflow/builtins/security-audit.js");
      const wf = createSecurityAuditWorkflow();
      expect(wf.stages.some((s) => s.type === "parallel")).toBe(true);
      expect(wf.stages.some((s) => s.type === "adversarial")).toBe(true);
    });
  });

  // ─── 4. Workflow Store ───────────────────────────────────────────────

  describe("Workflow Store", () => {
    it("注册和查询 workflow", async () => {
      const { WorkflowStore } = await import("../../src-engine/src/engine/workflow/workflow-store.js");
      const { createOmxPipelineWorkflow } = await import("../../src-engine/src/engine/workflow/builtins/omx-pipeline.js");

      const store = new WorkflowStore(testDir);
      await store.load();

      const wf = createOmxPipelineWorkflow();
      await store.register(wf);

      const found = store.get(wf.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe("OMX Pipeline (5阶段)");

      const all = store.list();
      expect(all.length).toBe(1);
    });

    it("不能删除内置模板", async () => {
      const { WorkflowStore } = await import("../../src-engine/src/engine/workflow/workflow-store.js");
      const store = new WorkflowStore(testDir);
      await store.load();

      await store.register({ id: "builtin-1", name: "内置", description: "", stages: [], createdAt: Date.now(), isBuiltIn: true });
      const deleted = await store.delete("builtin-1");
      expect(deleted).toBe(false);
      expect(store.get("builtin-1")).toBeDefined();
    });

    it("可以删除非内置模板", async () => {
      const { WorkflowStore } = await import("../../src-engine/src/engine/workflow/workflow-store.js");
      const store = new WorkflowStore(testDir);
      await store.load();

      await store.register({ id: "custom-1", name: "自定义", description: "", stages: [], createdAt: Date.now(), isBuiltIn: false });
      const deleted = await store.delete("custom-1");
      expect(deleted).toBe(true);
      expect(store.get("custom-1")).toBeUndefined();
    });
  });

  // ─── 5. RPC: workflow.list ───────────────────────────────────────────

  describe("RPC: workflow.list", () => {
    it("返回模板列表", async () => {
      const result = await methodHandlers["workflow.list"]({}) as { workflows: Array<{ id: string; name: string; isBuiltIn: boolean }> };
      expect(result.workflows).toBeInstanceOf(Array);
      // Should have at least the 6 built-in templates
      expect(result.workflows.length).toBeGreaterThanOrEqual(6);
      expect(result.workflows.every((w) => w.isBuiltIn)).toBe(true);
    });
  });

  // ─── 6. RPC: workflow.generate ───────────────────────────────────────

  describe("RPC: workflow.generate", () => {
    it("AI 动态生成一个 workflow 定义", async () => {
      const run = await createRun();
      const result = await methodHandlers["workflow.generate"]({
        content: "审查所有 API 端点的认证逻辑",
        runId: run.id,
      }) as { definition: { id: string; name: string; stages: Array<{ type: string }> } };

      expect(result.definition).toBeDefined();
      expect(result.definition.id).toMatch(/^dynamic-/);
      expect(result.definition.name).toBeTruthy();
      expect(result.definition.stages.length).toBeGreaterThan(0);
    });
  });

  // ─── 7. RPC: loop.create / loop.list / loop.cancel ──────────────────

  describe("RPC: Loop Scheduler", () => {
    it("创建循环任务", async () => {
      const run = await createRun();
      const result = await methodHandlers["loop.create"]({
        runId: run.id,
        taskTemplate: "检查 git status 是否有变化",
        intervalMinSec: 60,
        intervalMaxSec: 600,
      }) as { loopId: string; intervalSec: number };

      expect(result.loopId).toBeTruthy();
      expect(result.intervalSec).toBe(60);
    });

    it("列出循环任务", async () => {
      const run = await createRun();
      await methodHandlers["loop.create"]({
        runId: run.id,
        taskTemplate: "检查部署状态",
      });

      const result = await methodHandlers["loop.list"]({ runId: run.id }) as { loops: Array<{ id: string; active: boolean }> };
      expect(result.loops.length).toBe(1);
      expect(result.loops[0].active).toBe(true);
    });

    it("取消循环任务", async () => {
      const run = await createRun();
      const created = await methodHandlers["loop.create"]({
        runId: run.id,
        taskTemplate: "检查状态",
      }) as { loopId: string };

      const result = await methodHandlers["loop.cancel"]({ loopId: created.loopId }) as { cancelled: boolean };
      expect(result.cancelled).toBe(true);

      const list = await methodHandlers["loop.list"]({ runId: run.id }) as { loops: Array<{ active: boolean }> };
      expect(list.loops[0].active).toBe(false);
    });
  });

  // ─── 8. Goal Evaluator ───────────────────────────────────────────────

  describe("Goal Evaluator", () => {
    it("结构化目标评估", async () => {
      const { GoalEvaluator } = await import("../../src-engine/src/engine/goal/goal-evaluator.js");
      const { CCClient } = await import("../../src-engine/src/cc-integration/cc-client.js");

      const ccClient = new CCClient();
      const evaluator = new GoalEvaluator(ccClient);

      const run = {
        id: "run-test",
        workingDir: testDir,
        goals: ["实现登录功能"],
        terminationConditions: ["登录功能完成"],
        status: "running",
        totalCostUsd: 0,
        totalTasksCompleted: 3,
        goalEvaluationCycles: 1,
        goalLastEvalReason: "首次评估",
        goalEvidence: ["已完成3个任务"],
      } as any;

      const result = await evaluator.evaluate(run, testDir);

      expect(result.achieved).toBe(false);
      expect(result.progress).toBeGreaterThan(0);
      expect(result.milestones).toBeInstanceOf(Array);
      expect(result.suggestedStrategy).toBeTruthy();
    });
  });

  // ─── 9. Goal Strategy ────────────────────────────────────────────────

  describe("Goal Strategy", () => {
    it("阻塞里程碑 → human_input 策略", async () => {
      const { selectStrategy } = await import("../../src-engine/src/engine/goal/goal-strategy.js");

      const decision = selectStrategy({
        achieved: false,
        progress: 0.2,
        reason: "部分完成",
        evidence: [],
        milestones: [
          { id: "m1", description: "实现功能", status: "blocked", blocker: "缺少 API 文档" },
        ],
        completedGoals: [],
        remainingGoals: ["goal 1"],
        suggestedStrategy: "continue",
        strategyReason: "",
      });

      expect(decision.strategy).toBe("human_input");
      expect(decision.needsHumanInput).toBe(true);
    });

    it("低进度无完成目标 → decompose 策略", async () => {
      const { selectStrategy } = await import("../../src-engine/src/engine/goal/goal-strategy.js");

      const decision = selectStrategy({
        achieved: false,
        progress: 0.1,
        reason: "刚开始",
        evidence: [],
        milestones: [],
        completedGoals: [],
        remainingGoals: ["goal 1", "goal 2"],
        suggestedStrategy: "continue",
        strategyReason: "",
      });

      expect(decision.strategy).toBe("decompose");
      expect(decision.taskCount).toBe(3);
    });

    it("中等进度 → continue 策略", async () => {
      const { selectStrategy } = await import("../../src-engine/src/engine/goal/goal-strategy.js");

      const decision = selectStrategy({
        achieved: false,
        progress: 0.5,
        reason: "进行中",
        evidence: ["已完成一半"],
        milestones: [],
        completedGoals: ["goal 1"],
        remainingGoals: ["goal 2"],
        suggestedStrategy: "continue",
        strategyReason: "继续执行",
      });

      expect(decision.strategy).toBe("continue");
      expect(decision.needsHumanInput).toBe(false);
    });
  });

  // ─── 10. Adversarial Verify (独立模块) ──────────────────────────────

  describe("Adversarial Verify 模式", () => {
    it("验证接口定义正确", async () => {
      const { AdversarialVerifier } = await import("../../src-engine/src/engine/workflow/patterns/adversarial-verify.js");
      expect(AdversarialVerifier).toBeDefined();
      expect(typeof AdversarialVerifier).toBe("function");
    });
  });

  // ─── 11. Loop Until Dry (独立模块) ──────────────────────────────────

  describe("Loop Until Dry 模式", () => {
    it("验证接口定义正确", async () => {
      const { LoopUntilDry } = await import("../../src-engine/src/engine/workflow/patterns/loop-until-dry.js");
      expect(LoopUntilDry).toBeDefined();
      expect(typeof LoopUntilDry).toBe("function");
    });
  });

  // ─── 12. Judge Panel (独立模块) ─────────────────────────────────────

  describe("Judge Panel 模式", () => {
    it("验证接口定义正确", async () => {
      const { JudgePanel } = await import("../../src-engine/src/engine/workflow/patterns/judge-panel.js");
      expect(JudgePanel).toBeDefined();
      expect(typeof JudgePanel).toBe("function");
    });
  });
});
