# Multi-Agent Pipeline Design

## 概述

将单任务执行从「一次 claude -p 调用」改为「4 阶段 agent pipeline」，每个子任务经过规划、开发、测试、审查四个独立阶段，审查不通过时自动回退到开发阶段修复，最多循环 3 次。

## 架构

### 核心类

新增 `TaskPipeline` 类（`src-engine/src/engine/task-pipeline.ts`），封装单个任务的 4 阶段流程。`Executor.executeSingleTask()` 调用 `TaskPipeline.run()` 替代直接调用 `CCClient`。

```
Executor.executeSingleTask()
  └── TaskPipeline.run(task, context, run)
        │
        ├── 1. planner()  → ExecutionPlan { steps, targetFiles, risks, testStrategy }
        ├── 2. developer(plan)  → 代码变更
        ├── 3. tester(plan, diff_summary)  → TestResult { testsWritten, allPassed, failures }
        ├── 4. reviewer(plan, diff_summary, test_result)  → ReviewResult { approved, issues }
        │     └── 不通过 → 回到 2 (max 3 loops)
        │
        └── 返回 PipelineResult
              │
              └── Executor 继续现有评分/提交/revert 逻辑
```

### 职责边界

- **TaskPipeline**: 执行 4 阶段 + 修复循环，返回结构化结果
- **Executor**: 调用 pipeline，基于结果做评分/提交/revert（现有逻辑不变）

## 四个 Agent 阶段

### Phase 1: Planner（规划）

- **工具**: Read, Glob, Grep, Bash（只读）
- **maxTurns**: 15
- **输入**: 任务描述 + 项目上下文（goals, commits, lessons）
- **输出**: ExecutionPlan JSON

```ts
interface ExecutionPlan {
  understanding: string;   // 对任务的理解
  steps: string[];         // 实施步骤（3-8步）
  targetFiles: string[];   // 预计修改的文件
  risks: string[];         // 风险点
  testStrategy: string;    // 测试策略
}
```

Planner 只在第 1 次循环调用。后续修复循环复用同一计划。

### Phase 2: Developer（开发）

- **工具**: Read, Write, Edit, Bash, Glob, Grep（读写）
- **maxTurns**: 40
- **输入**: 任务描述 + ExecutionPlan + 修复反馈（第 2+ 次循环时注入 reviewer 的拒绝原因和 tester 的失败信息）
- **输出**: 直接在工作目录中修改文件

修复反馈注入格式：
```
## Previous Attempt Feedback
The reviewer rejected your previous changes. Please fix the following issues:

### Reviewer Feedback:
{reviewer.summary}

### Critical Issues:
{reviewer.issues.filter(i => i.severity === "critical").map(...)}

### Test Failures:
{tester.failures}
```

### Phase 3: Tester（测试）

- **工具**: Read, Write, Edit, Bash, Glob, Grep（读写，需要写测试文件）
- **maxTurns**: 25
- **输入**: ExecutionPlan + git diff 摘要
- **输出**: TestResult JSON

```ts
interface TestResult {
  testsWritten: string[];  // 写了哪些测试
  allPassed: boolean;      // 是否全部通过
  failures: string[];      // 失败的测试
  coverage: string;        // 覆盖范围描述
}
```

### Phase 4: Reviewer（审查）

- **工具**: Read, Bash, Glob, Grep（只读）
- **maxTurns**: 20
- **输入**: ExecutionPlan + git diff 摘要 + TestResult
- **输出**: ReviewResult JSON

```ts
interface ReviewResult {
  approved: boolean;
  score: number;  // 0-1
  issues: Array<{
    severity: "critical" | "major" | "minor";
    file: string;
    line?: number;
    description: string;
    suggestion: string;
  }>;
  summary: string;
}
```

### 修复循环

```
Loop 1: planner → developer → tester → reviewer
                                         ↓ rejected
Loop 2: developer(feedback) → tester → reviewer
                                          ↓ rejected
Loop 3: developer(feedback) → tester → reviewer
                                          ↓ still rejected → 返回最终结果
```

- 最多 3 次循环
- 达到 3 次仍未通过，返回最后一次 review 结果给 Executor 做最终评分

## 数据模型

### 新增类型

```ts
// shared/src/enums.ts
type TaskPhase = "planner" | "developer" | "tester" | "reviewer";
```

### 新增接口

```ts
// shared/src/task-types.ts

interface ExecutionPlan {
  understanding: string;
  steps: string[];
  targetFiles: string[];
  risks: string[];
  testStrategy: string;
}

interface TestResult {
  testsWritten: string[];
  allPassed: boolean;
  failures: string[];
  coverage: string;
}

interface ReviewIssue {
  severity: "critical" | "major" | "minor";
  file: string;
  line?: number;
  description: string;
  suggestion: string;
}

interface ReviewResult {
  approved: boolean;
  score: number;
  issues: ReviewIssue[];
  summary: string;
}

interface PhaseRecord {
  phase: TaskPhase;
  durationMs: number;
  costUsd: number;
  turns: number;
  iteration: number;  // 1-based
}

interface PipelineResult {
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
```

### 改动现有类型

```ts
// TaskDefinition 新增字段
interface TaskDefinition {
  // ... 现有字段不变
  pipelinePhases?: PhaseRecord[];
  pipelineIterations?: number;
}

// ExecutionRun 简化
interface ExecutionRun {
  // ... 移除以下字段:
  // executionMode → 不再需要，始终 pipeline
  // maxConcurrentAgents → 不再需要
  // agentRoles → 角色内置到 pipeline-prompts
}

// ExecutionMode 简化
type ExecutionMode = "pipeline";
```

## Executor 集成

### executeSingleTask 改造

```ts
// 改造前
const stream = this.ccClient.executeTaskStream(task.content, { ... });

// 改造后
const pipeline = new TaskPipeline(this.ccClient, this.notify, run.workingDir);
const pipelineResult = await pipeline.run(task, context);
// 后续评分/提交/revert 用 pipelineResult 替代原 result
```

评分阶段改为优先使用 reviewer 的 score（如果 pipeline 完成），否则回退到现有评分逻辑。

### RPC 通知

每进入一个新阶段广播：
```ts
notify("task.phase", {
  taskId: task.id,
  runId: run.id,
  phase: "planner" | "developer" | "tester" | "reviewer",
  iteration: number,
});
```

## 错误处理

| 场景 | 处理 |
|------|------|
| Planner 失败 | 整个任务失败，不重试规划 |
| Developer 失败 | 进入下一轮修复循环（如果有剩余次数） |
| Tester 失败 | 视为测试未通过，reviewer 会标注缺少测试 |
| Reviewer 失败（解析失败） | 默认 approved=false，进入修复循环 |
| 达到最大循环次数 | 返回最后一次 review，由 Executor 评分 |
| 单阶段超时 | 该阶段失败，不阻塞（developer 超时则进入修复循环） |

## 配置

```ts
interface PipelineConfig {
  maxFixIterations: number;     // 默认 3
  plannerMaxTurns: number;      // 默认 15
  developerMaxTurns: number;    // 默认 40
  testerMaxTurns: number;       // 默认 25
  reviewerMaxTurns: number;     // 默认 20
}
```

通过 `config.set` RPC 方法在设置页面调整。

## 上下文传递方式

无状态 prompt 注入。每个 agent 独立的 `claude -p` 调用，前序阶段的输出摘要注入 system prompt：

```
[Planner] → 输出 ExecutionPlan JSON
[Developer] system prompt += ExecutionPlan
[Tester] system prompt += ExecutionPlan + git diff 摘要
[Reviewer] system prompt += ExecutionPlan + git diff 摘要 + TestResult JSON
[Developer 修复轮] system prompt += ExecutionPlan + Reviewer 反馈 + Tester 失败信息
```

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 新增 | `src-engine/src/engine/task-pipeline.ts` |
| 新增 | `src-engine/src/engine/pipeline-prompts.ts` |
| 修改 | `src-engine/src/engine/executor.ts` |
| 修改 | `shared/src/task-types.ts` |
| 修改 | `shared/src/enums.ts` |
| 修改 | `src-engine/src/json-rpc/methods.ts` |
| 删除 | `src-engine/src/engine/worker-agent.ts` |
| 删除 | `src-engine/src/engine/agent-roles.ts` |
