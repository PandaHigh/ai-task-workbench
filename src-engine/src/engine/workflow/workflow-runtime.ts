/**
 * WorkflowRuntime — 统一工作流执行引擎
 *
 * 所有复杂任务都通过此引擎执行。支持：
 *   - AgentStage: 单 Agent 执行（复用 AgentExecutor）
 *   - ParallelStage: 并行执行（复用 ExecutionPool）
 *   - SequenceStage: 顺序执行 + 质量门控
 *   - LoopStage: 条件循环 + 共识检测
 *   - AdversarialStage: 对抗性验证（N voter 投票）
 *   - ConditionStage: 条件分支
 */

import type { TaskDefinition } from "@ai-workbench/shared";
import { CCClient } from "../../cc-integration/cc-client.js";
import { AgentExecutor } from "../agents/agent-executor.js";
import { getOmxRole, omxRoleToLegacy } from "../omx-roles.js";
import type {
  WorkflowDefinition,
  WorkflowStage,
  WorkflowExecution,
  WorkflowContext,
  WorkflowResult,
  StageOutput,
  StageStatus,
  AgentStage,
  ParallelStage,
  SequenceStage,
  LoopStage,
  AdversarialStage,
  ConditionStage,
} from "./workflow-types.js";

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

export class WorkflowRuntime {
  private ccClient: CCClient;
  private notify: NotifyFn;
  /** 缓存已完成的阶段输出，支持暂停恢复 */
  private completedStages = new Map<string, StageOutput>();
  /** 活跃的执行实例 */
  private activeExecutions = new Map<string, AbortController>();

  constructor(ccClient: CCClient, notify: NotifyFn) {
    this.ccClient = ccClient;
    this.notify = notify;
  }

  /**
   * 执行一个 workflow。
   *
   * @param definition workflow 定义
   * @param task 关联的任务
   * @param workingDir 工作目录
   * @param signal 取消信号
   * @returns 执行结果
   */
  async execute(
    definition: WorkflowDefinition,
    task: TaskDefinition,
    workingDir: string,
    signal?: AbortSignal,
  ): Promise<WorkflowResult> {
    const executionId = `wf-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const abortController = new AbortController();
    this.activeExecutions.set(executionId, abortController);

    // 如果外部 signal 被触发，也终止内部
    const onExternalAbort = () => abortController.abort();
    signal?.addEventListener("abort", onExternalAbort);

    const execution: WorkflowExecution = {
      id: executionId,
      definitionId: definition.id,
      runId: task.runId,
      taskId: task.id,
      status: "running",
      stages: definition.stages.map((s) => ({
        stageId: s.id,
        stageName: s.name,
        status: "pending" as StageStatus,
      })),
      currentStageIndex: 0,
      totalAgents: 0,
      completedAgents: 0,
      totalCostUsd: 0,
      totalDurationMs: 0,
      createdAt: Date.now(),
    };

    const context: WorkflowContext = {
      workingDir,
      goals: [],
      taskContent: task.content,
      stageOutputs: this.completedStages,
      lastOutput: null,
      budgetRemaining: Infinity,
      budgetUsed: 0,
    };

    this.notify("workflow.started", {
      executionId,
      definitionId: definition.id,
      definitionName: definition.name,
      stageCount: definition.stages.length,
      taskId: task.id,
      runId: task.runId,
    });

    const startTime = Date.now();
    let allGatesPassed = true;

    try {
      for (let i = 0; i < definition.stages.length; i++) {
        if (abortController.signal.aborted) {
          execution.status = "cancelled";
          break;
        }

        const stage = definition.stages[i];
        execution.currentStageIndex = i;

        // 跳过已完成的阶段（恢复场景）
        const stageExec = execution.stages[i];
        if (stageExec.status === "passed") {
          context.lastOutput = this.completedStages.get(stage.id) ?? null;
          continue;
        }

        // 执行阶段
        const stageResult = await this.executeStage(stage, context, task, execution, abortController.signal);

        // 更新执行记录
        stageExec.status = stageResult ? "passed" : "failed";
        stageExec.completedAt = Date.now();
        stageExec.durationMs = stageResult?.durationMs ?? 0;
        stageExec.costUsd = stageResult?.costUsd ?? 0;

        if (stageResult) {
          this.completedStages.set(stage.id, stageResult);
          context.stageOutputs.set(stage.id, stageResult);
          context.lastOutput = stageResult;
          context.budgetUsed += stageResult.costUsd;

          this.notify("workflow.phase.completed", {
            executionId,
            stageId: stage.id,
            stageName: stage.name,
            durationMs: stageResult.durationMs,
            costUsd: stageResult.costUsd,
          });
        } else {
          allGatesPassed = false;
          stageExec.error = "Stage execution returned no result";
          this.notify("workflow.phase.failed", {
            executionId,
            stageId: stage.id,
            stageName: stage.name,
          });

          // 非循环阶段失败则终止（SequenceStage 的 loopBack 由内部处理）
          if (stage.type !== "loop") {
            execution.status = "failed";
            execution.error = `Stage "${stage.name}" failed`;
            break;
          }
        }

        execution.totalCostUsd += stageResult?.costUsd ?? 0;
      }

      if (execution.status === "running") {
        execution.status = "completed";
      }
    } catch (err) {
      execution.status = "failed";
      execution.error = err instanceof Error ? err.message : String(err);
    } finally {
      execution.totalDurationMs = Date.now() - startTime;
      execution.completedAt = Date.now();
      this.activeExecutions.delete(executionId);
      signal?.removeEventListener("abort", onExternalAbort);
    }

    // 构建最终结果
    const finalOutput = context.lastOutput?.text ?? "";

    this.notify("workflow.completed", {
      executionId,
      definitionId: definition.id,
      status: execution.status,
      totalDurationMs: execution.totalDurationMs,
      totalCostUsd: execution.totalCostUsd,
      totalAgents: execution.totalAgents,
    });

    return {
      finalOutput,
      stageOutputs: this.completedStages,
      totalDurationMs: execution.totalDurationMs,
      totalCostUsd: execution.totalCostUsd,
      totalAgents: execution.totalAgents,
      allGatesPassed,
    };
  }

  /** 暂停执行 */
  pause(executionId: string): void {
    const controller = this.activeExecutions.get(executionId);
    controller?.abort();
  }

  // ─── Stage 执行分发 ──────────────────────────────────────────────────

  private async executeStage(
    stage: WorkflowStage,
    context: WorkflowContext,
    task: TaskDefinition,
    execution: WorkflowExecution,
    signal: AbortSignal,
  ): Promise<StageOutput | null> {
    switch (stage.type) {
      case "agent":
        return this.executeAgentStage(stage, context, task, execution, signal);
      case "parallel":
        return this.executeParallelStage(stage, context, task, execution, signal);
      case "sequence":
        return this.executeSequenceStage(stage, context, task, execution, signal);
      case "loop":
        return this.executeLoopStage(stage, context, task, execution, signal);
      case "adversarial":
        return this.executeAdversarialStage(stage, context, task, execution, signal);
      case "condition":
        return this.executeConditionStage(stage, context, task, execution, signal);
      default:
        console.warn(`[workflow] Unknown stage type: ${(stage as WorkflowStage).type}`);
        return null;
    }
  }

  // ─── Agent 阶段 ──────────────────────────────────────────────────────

  private async executeAgentStage(
    stage: AgentStage,
    context: WorkflowContext,
    task: TaskDefinition,
    execution: WorkflowExecution,
    _signal: AbortSignal,
  ): Promise<StageOutput | null> {
    const omxRole = getOmxRole(stage.role);
    if (!omxRole) {
      console.error(`[workflow] Unknown role: ${stage.role}`);
      return null;
    }
    const role = omxRoleToLegacy(omxRole);

    execution.totalAgents++;
    this.notify("workflow.agent.started", {
      stageId: stage.id,
      stageName: stage.name,
      role: stage.role,
      roleName: omxRole.name,
    });

    const startTime = Date.now();
    try {
      const agentExecutor = new AgentExecutor(this.ccClient, (method, params) => {
        this.notify(method, params);
      });

      // 构建提示词，注入上下文
      const promptWithContext = this.buildAgentPrompt(stage.prompt, context, task);

      const agentResult = await agentExecutor.execute(role, promptWithContext, context.workingDir);

      execution.completedAgents++;
      const durationMs = Date.now() - startTime;
      const costUsd = agentResult.totalCostUsd;

      this.notify("workflow.agent.completed", {
        stageId: stage.id,
        stageName: stage.name,
        role: stage.role,
        durationMs,
        costUsd,
        turns: agentResult.numTurns,
      });

      return {
        stageId: stage.id,
        text: agentResult.output ?? "",
        durationMs,
        costUsd,
      };
    } catch (err) {
      console.error(`[workflow] Agent stage "${stage.name}" failed:`, err);
      return null;
    }
  }

  // ─── Parallel 阶段 ──────────────────────────────────────────────────

  private async executeParallelStage(
    stage: ParallelStage,
    context: WorkflowContext,
    task: TaskDefinition,
    execution: WorkflowExecution,
    signal: AbortSignal,
  ): Promise<StageOutput | null> {
    const concurrency = stage.maxConcurrency ?? 4;
    const results: StageOutput[] = [];
    let totalCost = 0;

    // 简单的并发控制：按批次执行
    for (let i = 0; i < stage.stages.length; i += concurrency) {
      if (signal.aborted) break;

      const batch = stage.stages.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map((s) => this.executeStage(s, context, task, execution, signal))
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled" && result.value) {
          results.push(result.value);
          totalCost += result.value.costUsd;
        }
      }
    }

    if (results.length === 0) return null;

    return {
      stageId: stage.id,
      text: results.map((r) => r.text).join("\n\n---\n\n"),
      data: { parallelResults: results.map((r) => ({ stageId: r.stageId, text: r.text })) },
      durationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
      costUsd: totalCost,
    };
  }

  // ─── Sequence 阶段 ──────────────────────────────────────────────────

  private async executeSequenceStage(
    stage: SequenceStage,
    context: WorkflowContext,
    task: TaskDefinition,
    execution: WorkflowExecution,
    signal: AbortSignal,
  ): Promise<StageOutput | null> {
    const maxLoops = stage.maxReviewLoops ?? 0;
    let loopCount = 0;
    let lastOutput: StageOutput | null = null;

    const executeOnce = async (): Promise<boolean> => {
      for (const subStage of stage.stages) {
        if (signal.aborted) return false;

        const result = await this.executeStage(subStage, context, task, execution, signal);
        if (!result) {
          // 如果设置了 loopBackTo，且还没超过最大循环次数
          if (stage.loopBackTo && loopCount < maxLoops) {
            return false; // 触发重新执行
          }
          return false; // 终止
        }

        lastOutput = result;
        this.completedStages.set(subStage.id, result);
        context.stageOutputs.set(subStage.id, result);
        context.lastOutput = result;

        // 质量门控
        if (subStage.gateThreshold && subStage.gateThreshold > 0) {
          // 基本质量检查：如果输出包含 "FAIL" 或分数信息，评估是否通过
          // 完整实现需要调用 OmxAmpGate
          this.notify("workflow.phase.completed", {
            executionId: execution.id,
            stageId: subStage.id,
            stageName: subStage.name,
            durationMs: result.durationMs,
            costUsd: result.costUsd,
          });
        }
      }
      return true;
    };

    // 第一次执行
    let passed = await executeOnce();

    // 如果失败且有 loopBackTo，循环重试
    while (!passed && stage.loopBackTo && loopCount < maxLoops) {
      loopCount++;
      this.notify("workflow.loop.iteration", {
        executionId: execution.id,
        stageId: stage.id,
        stageName: stage.name,
        iteration: loopCount,
        maxIterations: maxLoops,
        reason: "Stage failed, looping back",
      });
      passed = await executeOnce();
    }

    if (!lastOutput) return null;

    const out: StageOutput = lastOutput;
    return {
      stageId: stage.id,
      text: out.text,
      data: { iterations: loopCount + 1, passed },
      durationMs: out.durationMs,
      costUsd: out.costUsd,
    };
  }

  // ─── Loop 阶段 ──────────────────────────────────────────────────────

  private async executeLoopStage(
    stage: LoopStage,
    context: WorkflowContext,
    task: TaskDefinition,
    execution: WorkflowExecution,
    signal: AbortSignal,
  ): Promise<StageOutput | null> {
    const results: StageOutput[] = [];
    let totalCost = 0;

    for (let iteration = 0; iteration < stage.maxIterations; iteration++) {
      if (signal.aborted) break;

      this.notify("workflow.loop.iteration", {
        executionId: execution.id,
        stageId: stage.id,
        stageName: stage.name,
        iteration: iteration + 1,
        maxIterations: stage.maxIterations,
      });

      let allPassed = true;
      let iterationOutput: StageOutput | null = null;

      for (const bodyStage of stage.body) {
        const result = await this.executeStage(bodyStage, context, task, execution, signal);
        if (!result) {
          allPassed = false;
          break;
        }
        iterationOutput = result;
        totalCost += result.costUsd;
      }

      if (iterationOutput) {
        results.push(iterationOutput);
      }

      // 共识模式：所有阶段都通过才退出
      if (stage.consensus && allPassed) {
        break;
      }

      // 非共识模式：至少执行一次，有输出就继续（由 maxIterations 控制）
      if (!stage.consensus && iteration === 0 && allPassed) {
        // 简单模式：第一次通过就退出
        break;
      }
    }

    if (results.length === 0) return null;

    return {
      stageId: stage.id,
      text: results.map((r) => r.text).join("\n\n---\n\n"),
      data: { iterations: results.length },
      durationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
      costUsd: totalCost,
    };
  }

  // ─── Adversarial 阶段 ────────────────────────────────────────────────

  private async executeAdversarialStage(
    stage: AdversarialStage,
    context: WorkflowContext,
    _task: TaskDefinition,
    execution: WorkflowExecution,
    _signal: AbortSignal,
  ): Promise<StageOutput | null> {
    // 获取被验证的目标输出
    const targetOutput = stage.targetStageId
      ? context.stageOutputs.get(stage.targetStageId)
      : context.lastOutput;

    if (!targetOutput) {
      console.warn(`[workflow] Adversarial stage "${stage.name}": no target output to verify`);
      return {
        stageId: stage.id,
        text: "No target output to verify — skipped",
        durationMs: 0,
        costUsd: 0,
      };
    }

    // 并行启动 N 个 voter
    const voters = Array.from({ length: stage.voterCount }, (_, i) => `voter-${i + 1}`);
    const votes: Array<{ voterId: string; passed: boolean; reason: string }> = [];

    let totalCost = 0;
    const startTime = Date.now();

    const votePromises = voters.map(async (voterId) => {
      execution.totalAgents++;
      this.notify("workflow.agent.started", {
        stageId: stage.id,
        stageName: stage.name,
        role: "momus",
        voterId,
      });

      try {
        const omxRole = getOmxRole("momus");
        if (!omxRole) throw new Error("Role 'momus' not found");
        const role = omxRoleToLegacy(omxRole);

        const voterPrompt = `${stage.voterPrompt}\n\n--- 被验证的内容 ---\n${targetOutput.text}\n\n请仔细审查以上内容，尝试找出反驳理由。如果你无法找到有效的反驳理由，回复 PASSED。否则回复 FAILED 并说明理由。`;

        const agentExecutor = new AgentExecutor(this.ccClient, (method, params) => {
          this.notify(method, params);
        });

        const result = await agentExecutor.execute(role, voterPrompt, context.workingDir);
        const output = result.output ?? "";
        const passed = output.toUpperCase().includes("PASSED") && !output.toUpperCase().includes("FAILED");
        const cost = result.totalCostUsd;
        totalCost += cost;

        const vote = { voterId, passed, reason: output.substring(0, 500) };
        votes.push(vote);

        execution.completedAgents++;
        this.notify("workflow.adversarial.vote", {
          executionId: execution.id,
          stageId: stage.id,
          voterId,
          passed,
          reason: vote.reason,
        });
        this.notify("workflow.agent.completed", {
          stageId: stage.id,
          voterId,
          durationMs: Date.now() - startTime,
          costUsd: cost,
        });
      } catch (err) {
        const vote = { voterId, passed: false, reason: `Voter error: ${err instanceof Error ? err.message : String(err)}` };
        votes.push(vote);
      }
    });

    await Promise.all(votePromises);

    // 计算通过率
    const passCount = votes.filter((v) => v.passed).length;
    const passRate = votes.length > 0 ? passCount / votes.length : 0;
    const overallPassed = passRate >= stage.passThreshold;

    this.notify("workflow.phase.completed", {
      executionId: execution.id,
      stageId: stage.id,
      stageName: stage.name,
      passed: overallPassed,
      passRate: `${passCount}/${votes.length}`,
    });

    return {
      stageId: stage.id,
      text: overallPassed
        ? `对抗性验证通过 (${passCount}/${votes.length})`
        : `对抗性验证未通过 (${passCount}/${votes.length})`,
      data: { votes, passRate, passed: overallPassed },
      durationMs: Date.now() - startTime,
      costUsd: totalCost,
    };
  }

  // ─── Condition 阶段 ──────────────────────────────────────────────────

  private async executeConditionStage(
    stage: ConditionStage,
    context: WorkflowContext,
    task: TaskDefinition,
    execution: WorkflowExecution,
    signal: AbortSignal,
  ): Promise<StageOutput | null> {
    // 简单条件评估：支持引用 stageOutputs 中的字段
    let conditionMet = false;
    try {
      const outputsObj: Record<string, unknown> = {};
      for (const [key, val] of context.stageOutputs) {
        outputsObj[key] = val.data ?? val.text;
      }
      const fn = new Function("outputs", "taskContent", `return (${stage.expression});`);
      conditionMet = !!fn(outputsObj, task.content);
    } catch {
      // 条件评估失败默认走 else
      conditionMet = false;
    }

    const targetStage = conditionMet ? stage.thenStage : stage.elseStage;
    if (!targetStage) {
      return {
        stageId: stage.id,
        text: `条件 ${conditionMet ? "为真" : "为假"}，无对应分支，跳过`,
        durationMs: 0,
        costUsd: 0,
      };
    }

    return this.executeStage(targetStage, context, task, execution, signal);
  }

  // ─── 工具方法 ─────────────────────────────────────────────────────────

  /** 构建 Agent 提示词，注入 workflow 上下文 */
  private buildAgentPrompt(
    stagePrompt: string,
    context: WorkflowContext,
    task: TaskDefinition,
  ): string {
    const parts: string[] = [];

    if (context.goals.length > 0) {
      parts.push(`## 目标\n${context.goals.join("\n")}`);
    }

    parts.push(`## 任务\n${task.content}`);

    if (context.lastOutput) {
      parts.push(`## 上一阶段输出\n${context.lastOutput.text.substring(0, 3000)}`);
    }

    parts.push(`## 指令\n${stagePrompt}`);

    return parts.join("\n\n");
  }
}
