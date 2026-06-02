# 功能精简实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 10 个低价值模块，简化 5 个过度设计的子系统，使系统聚焦全自动执行 + 团队协作

**Architecture:** 自底向上清理——先移除 shared 类型定义，再删除后端模块和引用，再删除前端组件和引用，最后简化剩余模块

**Tech Stack:** TypeScript, React, Vitest

---

## Task 1: 移除 shared 类型

**Files:**
- Delete: `shared/src/schedule-types.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/src/task-types.ts`
- Modify: `shared/src/rpc-types.ts`

- [ ] **Step 1: 删除 schedule-types.ts**

```bash
rm shared/src/schedule-types.ts
```

- [ ] **Step 2: 移除 index.ts 中的 re-export**

文件 `shared/src/index.ts`，删除这行：
```
export * from "./schedule-types.js";
```

- [ ] **Step 3: 从 task-types.ts 移除已废弃的类型**

移除以下类型定义（精确行号见 spec 分析）：
- `FeatureItem` 接口
- `ReviewSuggestion` 接口
- `ErrorSeverity` 类型别名
- `DetectedError` 接口
- `ActivityEvent` 接口
- `ExecutionRun` 中的 `features?: FeatureItem[]` 和 `featuresGeneratedAt?: number` 字段

- [ ] **Step 4: 从 rpc-types.ts 移除已废弃的类型和方法**

移除：
- `TraceSpan` 接口
- `AgentDecision` 接口
- EngineMethod 中：`"trace.list"`, `"suggestion.list"`, `"error.history"`, `"schedule.create"`, `"schedule.list"`, `"schedule.delete"`, `"schedule.toggle"`, `"snapshot.create"`, `"snapshot.list"`, `"snapshot.restore"`, `"task.intervene"`, `"task.inject"`, `"notification.rules"`, `"notification.configure"`
- EngineNotification 中：`"features.generated"`, `"features.updated"`, `"trace.span"`, `"agent.decision"`, `"review.suggestion"`, `"error.detected"`, `"task.autoFix"`

- [ ] **Step 5: 验证 shared 编译通过**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/shared && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: 移除 shared 中已废弃的类型定义（schedule, trace, feature, error, notification）"
```

---

## Task 2: 删除后端独立模块

**Files:**
- Delete: `src-engine/src/remote/remote-proxy.ts`
- Delete: `src-engine/src/engine/omx-research/experiment-runner.ts`
- Delete: `src-engine/src/engine/omx-research/evaluator.ts`
- Delete: `src-engine/src/lib/notification-rules.ts`
- Delete: `src-engine/src/lib/metrics.ts`
- Delete: `src-engine/src/lib/tracer.ts`
- Delete: `src-engine/src/lib/snapshot.ts`
- Delete: `src-engine/src/lib/readme-generator.ts`
- Delete: `src-engine/src/engine/error-watcher.ts`
- Delete: `src-engine/src/engine/task-scheduler.ts`

- [ ] **Step 1: 删除所有模块文件**

```bash
rm src-engine/src/remote/remote-proxy.ts
rm src-engine/src/engine/omx-research/experiment-runner.ts
rm src-engine/src/engine/omx-research/evaluator.ts
rm src-engine/src/lib/notification-rules.ts
rm src-engine/src/lib/metrics.ts
rm src-engine/src/lib/tracer.ts
rm src-engine/src/lib/snapshot.ts
rm src-engine/src/lib/readme-generator.ts
rm src-engine/src/engine/error-watcher.ts
rm src-engine/src/engine/task-scheduler.ts
```

如果目录为空，删除空目录：
```bash
rmdir src-engine/src/engine/omx-research 2>/dev/null; rmdir src-engine/src/remote 2>/dev/null; true
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "refactor: 删除 10 个低价值后端模块（remote, omx-research, notification, metrics, tracer, snapshot, readme, error-watcher, task-scheduler）"
```

---

## Task 3: 清理 index.ts 中的废弃引用

**Files:**
- Modify: `src-engine/src/index.ts`

- [ ] **Step 1: 移除 remote-proxy 导入和使用**

移除：
- `import { connectRemoteWS, disconnectRemoteWS } from "./remote/remote-proxy.js"`
- 所有调用 `connectRemoteWS` / `disconnectRemoteWS` 的代码块（启动时恢复 subscriptions 的逻辑）

- [ ] **Step 2: 移除 mcpManager.stopAll() 调用**

移除：`await mcpManager.stopAll()`（在 shutdown handler 中）

注意：`mcpManager` 本身在后续 Task 7 中处理，这里只移除 stopAll 调用。

- [ ] **Step 3: 验证编译**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-engine && npx tsc --noEmit`
Expected: 有残余错误是正常的（methods.ts 还没清理），只确认 index.ts 自身无误

- [ ] **Step 4: Commit**

```bash
git add src-engine/src/index.ts && git commit -m "refactor: 清理 index.ts 中 remote-proxy 和 mcpManager.stopAll 引用"
```

---

## Task 4: 清理 ws-server.ts 中的废弃引用

**Files:**
- Modify: `src-engine/src/ws-server.ts`

- [ ] **Step 1: 移除 metrics HTTP 路由**

移除 `/api/metrics` HTTP handler 中动态导入 `./lib/metrics.js` 的代码块。

- [ ] **Step 2: 验证编译**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-engine && npx tsc --noEmit`
Expected: 可能有残余错误（methods.ts 还没清理）

- [ ] **Step 3: Commit**

```bash
git add src-engine/src/ws-server.ts && git commit -m "refactor: 移除 ws-server 中的 /api/metrics 路由"
```

---

## Task 5: 清理 omx-executor.ts 中的废弃引用

**Files:**
- Modify: `src-engine/src/engine/omx-executor.ts`

- [ ] **Step 1: 移除 tracer 相关代码**

移除：
- `import { Tracer } from "../lib/tracer.js"`
- `private tracer: Tracer` 属性声明
- `this.tracer = new Tracer(...)` 初始化
- 所有 `this.tracer.startTrace()`, `this.tracer.startSpan(...)`, `this.tracer.endSpan(...)`, `this.tracer.endTrace()` 调用

- [ ] **Step 2: 移除 experiment-runner 相关代码**

移除：
- `import { OmxAmpExperimentRunner, type ExperimentConfig } from "./omx-research/experiment-runner.js"`
- 使用 `OmxAmpExperimentRunner` 的代码块

- [ ] **Step 3: 移除 readme-generator 相关代码**

移除：
- `const { generateReadme } = await import("../lib/readme-generator.js")` 动态导入
- `const readmeContent = generateReadme(...)` 调用及相关写入逻辑

- [ ] **Step 4: 验证编译**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-engine && npx tsc --noEmit`
Expected: 可能有残余错误（methods.ts 还没清理）

- [ ] **Step 5: Commit**

```bash
git add src-engine/src/engine/omx-executor.ts && git commit -m "refactor: 清理 omx-executor 中 tracer/experiment-runner/readme-generator 引用"
```

---

## Task 6: 清理 store.ts 中的废弃方法

**Files:**
- Modify: `src-engine/src/db/store.ts`

- [ ] **Step 1: 移除 ScheduledJob 相关导入和方法**

移除：
- `import { ScheduledJob } from "@ai-workbench/shared"`
- `getScheduledJobs()`, `saveScheduledJobs()`, `saveScheduledJob()`, `deleteScheduledJob()` 方法

- [ ] **Step 2: 移除 trace/activity/error/suggestion/snapshot 相关存储方法**

检查 store.ts 中是否有：
- trace span 存储方法 → 移除
- activity event 存储方法 → 移除
- detected error 存储方法 → 移除
- review suggestion 存储方法 → 移除
- snapshot 元数据存储方法 → 移除

- [ ] **Step 3: 验证编译**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-engine && npx tsc --noEmit`
Expected: 可能有残余错误

- [ ] **Step 4: Commit**

```bash
git add src-engine/src/db/store.ts && git commit -m "refactor: 清理 store.ts 中 schedule/trace/activity/error/suggestion/snapshot 存储方法"
```

---

## Task 7: 简化 Plugin 系统

**Files:**
- Modify: `src-engine/src/plugins/mcp-manager.ts`
- Modify: `src-engine/src/json-rpc/methods.ts`（MCP 部分）

- [ ] **Step 1: 简化 mcp-manager.ts**

移除所有子进程生命周期管理代码（spawn, kill, SIGTERM/SIGKILL, running status tracking）。只保留类声明作为空壳或完全删除。

如果 methods.ts 中有 `mcpManager.startServer(...)` / `mcpManager.stopServer(...)` / `mcpManager.isRunning(...)` 调用，这些需要在 methods.ts 中移除。

建议方案：直接删除 `mcp-manager.ts` 文件，从 methods.ts 中移除 `import { McpManager }` 和 `const mcpManager = new McpManager()` 以及所有 `mcpManager.*` 调用。Plugin 配置 CRUD 由 `plugin-registry.ts` 独立处理。

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "refactor: 简化 Plugin 系统，移除 MCP 子进程生命周期管理"
```

---

## Task 8: 清理 json-rpc/methods.ts（大清理）

**Files:**
- Modify: `src-engine/src/json-rpc/methods.ts`

这是最关键的清理步骤。需要：

- [ ] **Step 1: 移除废弃模块的导入**

移除所有对已删除文件的 import：
- `import * as remoteProxy from "../remote/remote-proxy.js"`
- `import { McpManager } from "../plugins/mcp-manager.js"`
- 其他指向已删除模块的 import

- [ ] **Step 2: 移除废弃的 RPC 方法处理器**

移除以下方法处理器：
- `trace.list`
- `suggestion.list`
- `error.history`
- `schedule.create`, `schedule.list`, `schedule.delete`, `schedule.toggle`
- `snapshot.create`, `snapshot.list`, `snapshot.restore`
- `notification.rules`, `notification.configure`
- `metrics.snapshot`
- 所有 `share.subscribe` / `share.unsubscribe` / `share.subscriptions` 中涉及 remoteProxy 的逻辑
- 所有 `run.list` / `run.tasks` / `run.commits` / `run.lessons` / `run.logs` 中涉及 remoteProxy 的逻辑

- [ ] **Step 3: 移除 mcpManager 相关逻辑**

移除 `export const mcpManager = new McpManager()` 和所有 plugin.toggle 中的 `mcpManager.startServer/stopServer/isRunning` 调用。

- [ ] **Step 4: 验证编译通过**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-engine && npx tsc --noEmit`
Expected: 编译通过，0 错误

- [ ] **Step 5: Commit**

```bash
git add src-engine/src/json-rpc/methods.ts && git commit -m "refactor: 清理 methods.ts 中 15+ 个废弃 RPC 方法处理器"
```

---

## Task 9: 删除前端组件文件

**Files:**
- Delete: `src-ui/src/components/evolution/TraceTimeline.tsx`
- Delete: `src-ui/src/components/evolution/TraceTimeline.test.tsx`
- Delete: `src-ui/src/components/evolution/ErrorStream.tsx`
- Delete: `src-ui/src/components/evolution/ErrorStream.test.tsx`
- Delete: `src-ui/src/components/evolution/ReviewSuggestions.tsx`
- Delete: `src-ui/src/components/evolution/ReviewSuggestions.test.tsx`
- Delete: `src-ui/src/components/evolution/FeatureBoard.tsx`
- Delete: `src-ui/src/components/evolution/FeatureBoard.test.tsx`
- Delete: `src-ui/src/components/evolution/ExecutionGraph.tsx`
- Delete: `src-ui/src/components/evolution/ExecutionGraph.test.tsx`
- Delete: `src-ui/src/components/evolution/ActivityTimeline.tsx`
- Delete: `src-ui/src/components/evolution/ActivityTimeline.test.tsx`
- Delete: `src-ui/src/components/evolution/PresencePanel.tsx`
- Delete: `src-ui/src/components/evolution/PresencePanel.test.tsx`
- Delete: `src-ui/src/components/settings/ScheduleManager.tsx`
- Delete: `src-ui/src/components/settings/ScheduleManager.test.tsx`

- [ ] **Step 1: 删除所有文件**

```bash
rm src-ui/src/components/evolution/TraceTimeline.tsx
rm src-ui/src/components/evolution/TraceTimeline.test.tsx
rm src-ui/src/components/evolution/ErrorStream.tsx
rm src-ui/src/components/evolution/ErrorStream.test.tsx
rm src-ui/src/components/evolution/ReviewSuggestions.tsx
rm src-ui/src/components/evolution/ReviewSuggestions.test.tsx
rm src-ui/src/components/evolution/FeatureBoard.tsx
rm src-ui/src/components/evolution/FeatureBoard.test.tsx
rm src-ui/src/components/evolution/ExecutionGraph.tsx
rm src-ui/src/components/evolution/ExecutionGraph.test.tsx
rm src-ui/src/components/evolution/ActivityTimeline.tsx
rm src-ui/src/components/evolution/ActivityTimeline.test.tsx
rm src-ui/src/components/evolution/PresencePanel.tsx
rm src-ui/src/components/evolution/PresencePanel.test.tsx
rm src-ui/src/components/settings/ScheduleManager.tsx
rm src-ui/src/components/settings/ScheduleManager.test.tsx
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "refactor: 删除 8 个前端组件及测试（TraceTimeline, ErrorStream, ReviewSuggestions, FeatureBoard, ExecutionGraph, ActivityTimeline, PresencePanel, ScheduleManager）"
```

---

## Task 10: 清理 EvolutionDashboard.tsx

**Files:**
- Modify: `src-ui/src/components/evolution/EvolutionDashboard.tsx`

- [ ] **Step 1: 移除已删组件的 import**

移除：
- `import { FeatureBoard } from "./FeatureBoard";`
- `import { PresencePanel } from "./PresencePanel";`
- `import { ActivityTimeline } from "./ActivityTimeline";`
- `import { TraceTimeline } from "./TraceTimeline";`
- `import { ErrorStream } from "./ErrorStream";`
- `import { ReviewSuggestions } from "./ReviewSuggestions";`
- `import { ExecutionGraph } from "./ExecutionGraph";`

- [ ] **Step 2: 简化 TabType**

将：
```ts
type TabType = "logs" | "commits" | "lessons" | "features" | "activity" | "trace" | "errors" | "suggestions" | "graph" | "report";
```
改为：
```ts
type TabType = "logs" | "commits" | "lessons" | "report";
```

- [ ] **Step 3: 移除已删 Tab 的渲染代码**

移除 Tab 内容区中对以下组件的渲染：
- `<FeatureBoard features={run.features} />`
- `<ActivityTimeline runId={...} />`
- TraceTab 子组件（TraceTimeline 的包装）
- `<ErrorStream runId={...} />`
- `<ReviewSuggestions runId={...} />`
- `<ExecutionGraph tasks={queue} />`

移除 Tab 按钮区中对应的 Tab 切换按钮。

- [ ] **Step 4: 移除 PresencePanel 使用**

移除 `presenceSlot={<PresencePanel />}` 传递。

- [ ] **Step 5: 移除 snapshot 相关 UI**

移除 EvolutionDashboard 中的快照 section（"快照" 标题 + snapshot.create/list/restore 调用）。

- [ ] **Step 6: 验证编译**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-ui && npx tsc --noEmit`
Expected: 可能有残余错误（stores/hooks 还没清理）

- [ ] **Step 7: Commit**

```bash
git add src-ui/src/components/evolution/EvolutionDashboard.tsx && git commit -m "refactor: 清理 EvolutionDashboard，移除 6 个已删 Tab 和 snapshot UI"
```

---

## Task 11: 清理 SettingsPage.tsx

**Files:**
- Modify: `src-ui/src/components/settings/SettingsPage.tsx`

- [ ] **Step 1: 移除 ScheduleManager**

移除 `import { ScheduleManager } from "./ScheduleManager";` 和 `<ScheduleManager />` 渲染及其包裹的 section。

- [ ] **Step 2: 验证编译**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-ui && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src-ui/src/components/settings/SettingsPage.tsx && git commit -m "refactor: 移除 SettingsPage 中的 ScheduleManager 引用"
```

---

## Task 12: 清理 evolution-store.ts 和 useNotifications.ts

**Files:**
- Modify: `src-ui/src/stores/evolution-store.ts`
- Modify: `src-ui/src/hooks/useNotifications.ts`

- [ ] **Step 1: 清理 evolution-store.ts**

移除：
- `DetectedError`, `ReviewSuggestion` 类型导入
- `errors: DetectedError[]` 状态字段
- `suggestions: ReviewSuggestion[]` 状态字段
- `addError()`, `setErrors()`, `addSuggestion()`, `setSuggestions()` 方法
- `reset()` 中的 `errors: []` 和 `suggestions: []`

- [ ] **Step 2: 清理 useNotifications.ts**

移除以下 notification handler：
- `case "error.detected"` → 调用 addError 的代码块
- `case "review.suggestion"` → 调用 addSuggestion 的代码块
- `case "features.generated"` / `case "features.updated"` → feature 相关处理
- `case "presence.joined"` / `case "presence.left"` → presence 相关处理
- `case "activity.created"` → activity 相关处理
- `case "trace.span"` / `case "agent.decision"` → trace 相关处理

- [ ] **Step 3: 验证编译**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-ui && npx tsc --noEmit`
Expected: 编译通过，0 错误

- [ ] **Step 4: Commit**

```bash
git add src-ui/src/stores/evolution-store.ts src-ui/src/hooks/useNotifications.ts && git commit -m "refactor: 清理 evolution-store 和 useNotifications 中已废弃的状态/通知处理"
```

---

## Task 13: 简化 Profile 配置

**Files:**
- Modify: `src-engine/src/engine/builtin-profiles.ts`
- Modify: `src-ui/src/components/settings/ProfileManager.tsx`

- [ ] **Step 1: 简化内置 Profile**

从 `builtin-profiles.ts` 移除 Conservative 和 Aggressive Profile，只保留 Adaptive 和 Balanced。移除 `backgroundReview` 和 `errorWatchEnabled` 字段。

- [ ] **Step 2: 简化 ProfileManager.tsx**

移除自定义 Profile 创建/编辑表单 UI。只保留：
- Profile 列表展示
- 点击激活
- 删除非内置 Profile 的功能

- [ ] **Step 3: 验证编译**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-engine && npx tsc --noEmit && cd ../src-ui && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src-engine/src/engine/builtin-profiles.ts src-ui/src/components/settings/ProfileManager.tsx && git commit -m "refactor: 简化 Profile 配置，保留 2 个内置 Profile，移除自定义创建 UI"
```

---

## Task 14: 简化 Agent 角色

**Files:**
- Modify: `src-engine/src/engine/omx-roles.ts`

- [ ] **Step 1: 移除未使用的 Agent 角色**

保留 Pipeline 实际使用的 ~12 个核心角色：
- Explorer, Analyst, Planner, Architect
- Debugger, Executor, Verifier
- Quality Reviewer, Security Reviewer, Test Engineer
- Prometheus (Metis/Momus/Oracle)
- Git Master, Code Simplifier, Researcher

移除：
- Style Reviewer, API Reviewer, Performance Reviewer, Dependency Expert
- Designer, Writer, QA Tester
- Product Manager, UX Researcher, Information Architect, Product Analyst

- [ ] **Step 2: 验证 omx-pipeline.ts 和 omx-phases/ 中的角色引用仍然有效**

确认所有被引用的角色都还在保留列表中。如有缺失，补充保留。

- [ ] **Step 3: 验证编译**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-engine && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src-engine/src/engine/omx-roles.ts && git commit -m "refactor: 精简 Agent 角色至 ~12 个核心角色"
```

---

## Task 15: 清理测试文件

**Files:**
- Delete: `tests/engine/tracer.test.ts`
- Delete: `tests/engine/metrics.test.ts`
- Delete: `tests/engine/notification-rules.test.ts`
- Delete: `tests/engine/error-watcher.test.ts`
- Delete: `tests/engine/task-scheduler.test.ts`
- Delete: `tests/engine/snapshot.test.ts`
- Modify: `tests/engine/e2e-features.test.ts`
- Modify: `tests/engine/plugins.test.ts`

- [ ] **Step 1: 删除完整测试文件**

```bash
rm tests/engine/tracer.test.ts
rm tests/engine/metrics.test.ts
rm tests/engine/notification-rules.test.ts
rm tests/engine/error-watcher.test.ts
rm tests/engine/task-scheduler.test.ts
rm tests/engine/snapshot.test.ts
```

- [ ] **Step 2: 清理 e2e-features.test.ts**

移除其中对已删除模块的 import 和测试块：
- NotificationEngine 相关测试
- TaskScheduler/ScheduledJob 相关测试
- SnapshotManager 相关测试

- [ ] **Step 3: 清理 plugins.test.ts**

移除 McpManager 相关测试块。

- [ ] **Step 4: 运行所有后端测试**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench && npm run test -- --project engine 2>&1 | tail -30`
Expected: 所有测试通过

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: 清理已删除模块的测试文件"
```

---

## Task 16: 全量验证

- [ ] **Step 1: shared 编译**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/shared && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: engine 编译**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-engine && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: ui 编译**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-ui && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: engine 测试**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-engine && npx vitest run`
Expected: All tests passed

- [ ] **Step 5: ui 测试**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench/src-ui && npx vitest run`
Expected: All tests passed

- [ ] **Step 6: 全量构建**

Run: `cd /Users/zhanxinlong/code/ai-task-workbench && npm run build`
Expected: 构建成功

- [ ] **Step 7: 最终 Commit**

```bash
git add -A && git commit -m "refactor: 功能精简完成 — 移除 10 个模块，简化 5 个子系统"
```
