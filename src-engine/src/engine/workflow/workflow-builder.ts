/**
 * Workflow Builder — Fluent API
 *
 * 用于构建 WorkflowDefinition。内置模板和 AI 动态生成都通过此 API。
 *
 * 用法:
 *   const wf = WorkflowBuilder.create('security-audit')
 *     .description('安全审计工作流')
 *     .stage(new AgentStage(...))
 *     .stage(new ParallelStage(...))
 *     .build();
 */

import type {
  WorkflowDefinition,
  WorkflowStage,
  AgentStage,
  ParallelStage,
  SequenceStage,
  LoopStage,
  AdversarialStage,
} from "./workflow-types.js";

let stageCounter = 0;

function nextStageId(prefix: string): string {
  return `${prefix}-${++stageCounter}`;
}

// Reset counter for testing
export function resetStageCounter(): void {
  stageCounter = 0;
}

// ─── Stage factory helpers ───────────────────────────────────────────────

export function agentStage(opts: Omit<AgentStage, "id">): AgentStage {
  return { id: nextStageId("agent"), ...opts };
}

export function parallelStages(
  name: string,
  stages: WorkflowStage[],
  opts?: { maxConcurrency?: number; gateThreshold?: number; description?: string },
): ParallelStage {
  return {
    id: nextStageId("parallel"),
    type: "parallel",
    name,
    stages,
    maxConcurrency: opts?.maxConcurrency,
    gateThreshold: opts?.gateThreshold,
    description: opts?.description,
  };
}

export function sequenceStages(
  name: string,
  stages: WorkflowStage[],
  opts?: { gateThreshold?: number; loopBackTo?: string; maxReviewLoops?: number; description?: string },
): SequenceStage {
  return {
    id: nextStageId("sequence"),
    type: "sequence",
    name,
    stages,
    gateThreshold: opts?.gateThreshold,
    loopBackTo: opts?.loopBackTo,
    maxReviewLoops: opts?.maxReviewLoops,
    description: opts?.description,
  };
}

export function loopStages(
  name: string,
  body: WorkflowStage[],
  maxIterations: number,
  opts?: { consensus?: boolean; gateThreshold?: number; description?: string },
): LoopStage {
  return {
    id: nextStageId("loop"),
    type: "loop",
    name,
    body,
    maxIterations,
    consensus: opts?.consensus,
    gateThreshold: opts?.gateThreshold,
    description: opts?.description,
  };
}

export function adversarialStage(
  name: string,
  voterCount: number,
  voterPrompt: string,
  opts?: { passThreshold?: number; targetStageId?: string; gateThreshold?: number; description?: string },
): AdversarialStage {
  return {
    id: nextStageId("adversarial"),
    type: "adversarial",
    name,
    voterCount,
    passThreshold: opts?.passThreshold ?? 0.6,
    voterPrompt,
    targetStageId: opts?.targetStageId,
    gateThreshold: opts?.gateThreshold,
    description: opts?.description,
  };
}

// ─── Builder class ───────────────────────────────────────────────────────

export class WorkflowBuilder {
  private id: string;
  private _name: string;
  private _description = "";
  private _stages: WorkflowStage[] = [];
  private _tags: string[] = [];
  private _useCase = "";
  private _isBuiltIn = false;

  private constructor(id: string, name: string) {
    this.id = id;
    this._name = name;
  }

  static create(id: string, name?: string): WorkflowBuilder {
    resetStageCounter();
    return new WorkflowBuilder(id, name ?? id);
  }

  name(name: string): WorkflowBuilder {
    this._name = name;
    return this;
  }

  description(desc: string): WorkflowBuilder {
    this._description = desc;
    return this;
  }

  stage(stage: WorkflowStage): WorkflowBuilder {
    this._stages.push(stage);
    return this;
  }

  stages(stages: WorkflowStage[]): WorkflowBuilder {
    this._stages.push(...stages);
    return this;
  }

  tags(tags: string[]): WorkflowBuilder {
    this._tags = tags;
    return this;
  }

  useCase(desc: string): WorkflowBuilder {
    this._useCase = desc;
    return this;
  }

  builtIn(): WorkflowBuilder {
    this._isBuiltIn = true;
    return this;
  }

  build(): WorkflowDefinition {
    return {
      id: this.id,
      name: this._name,
      description: this._description,
      stages: this._stages,
      createdAt: Date.now(),
      isBuiltIn: this._isBuiltIn,
      tags: this._tags,
      useCase: this._useCase,
    };
  }
}
