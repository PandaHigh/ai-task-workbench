# 功能精简设计：聚焦执行 + 协作

**日期**: 2026-06-02
**目标**: 将系统定位为小而美的工具，移除低价值/过度设计的模块，减少 ~40% 复杂度
**定位**: 小团队（2-5人）全自动 AI 任务协作工具

## 设计决策

- 核心价值：全自动执行 + 团队分享协作
- 保留多 Agent 并行团队（omx-team）
- 保留完整 Skill 管理
- 保留 Playwright MCP

---

## 一、完全移除的模块

### 1.1 后端模块

| 模块 | 文件 | 行数 | 理由 |
|------|------|------|------|
| 远程代理 | `remote/remote-proxy.ts` | 192 | Share 系统已覆盖协作 |
| 实验运行器 | `engine/omx-research/` (experiment-runner.ts, evaluator.ts) | 227 | 小众功能 |
| 多通道通知 | `lib/notification-rules.ts` | 96 | WebSocket 实时推送足够 |
| 指标收集 | `lib/metrics.ts` | 100 | 调试工具 |
| 分布式追踪 | `lib/tracer.ts` | 98 | 调试工具 |
| 定时任务 | `engine/task-scheduler.ts` | 120 | 非核心 |
| 快照管理 | `lib/snapshot.ts` | 110 | Nice-to-have |
| README 生成 | `lib/readme-generator.ts` | 106 | Nice-to-have |
| 错误监听 | `engine/error-watcher.ts` | 70 | Pipeline 内已有错误处理 |

**后端合计移除**: ~1,119 行

### 1.2 前端组件

| 组件 | 文件 | 行数 | 理由 |
|------|------|------|------|
| 追踪时间线 | `components/evolution/TraceTimeline.tsx` | 172 | 追踪功能已移除 |
| 错误流 | `components/evolution/ErrorStream.tsx` | 91 | 错误监听已移除 |
| 审查建议 | `components/evolution/ReviewSuggestions.tsx` | 95 | Pipeline 已有 code-review |
| 特性清单 | `components/evolution/FeatureBoard.tsx` | 99 | 过度设计的验证功能 |
| 执行图 | `components/evolution/ExecutionGraph.tsx` | 181 | DAG 可视化非核心 |
| 定时任务管理 | `components/settings/ScheduleManager.tsx` | 148 | 定时任务已移除 |

**前端合计移除**: ~786 行

### 1.3 共享类型

| 文件 | 处理 |
|------|------|
| `shared/src/schedule-types.ts` | 整个文件移除 |
| `shared/src/task-types.ts` | 移除 ScheduledJob, FeatureItem, TraceSpan, AgentDecision, DetectedError, ErrorSeverity, ReviewSuggestion |
| `shared/src/rpc-types.ts` | 移除 schedule.*, trace.*, metrics.*, snapshot.*, error.*, suggestion.*, activity.* 相关方法/通知定义 |

### 1.4 需清理的关联代码

- `index.ts`: 移除 remote subscriptions 恢复、Playwright 自动注册中的 notification/metrics/tracer 引用
- `ws-server.ts`: 移除 `/api/metrics` HTTP 路由、snapshot 相关路由
- `json-rpc/methods.ts`: 移除约 15 个 RPC 方法处理器及相关 store/manager 引用
- `omx-executor.ts`: 移除 tracer 调用、snapshot 调用、error watcher 集成、readme 生成调用、feature 生成/验证
- `omx-pipeline.ts`: 移除 feature 相关阶段逻辑

---

## 二、简化的模块

### 2.1 Plugin 系统

**保留**: MCP 配置注册（name/command/args/env 的 CRUD），`plugin.list`, `plugin.install`, `plugin.remove`, `plugin.toggle` RPC 方法

**移除**: `mcp-manager.ts` 中的子进程 spawn/kill 生命周期管理。插件由 Claude CLI 自行发现和管理，引擎只负责配置持久化。

**影响文件**:
- `plugins/mcp-manager.ts` → 大幅精简或合并到 `plugin-registry.ts`
- `index.ts` 中移除 MCP manager 的 spawn/shutdown 逻辑

### 2.2 Profile 配置

**保留**: 2 个内置 Profile（Adaptive/Balanced）+ `ProfileManager.tsx` 中选择激活的 UI

**移除**:
- `builtin-profiles.ts` 中的 Conservative 和 Aggressive Profile
- `ProfileManager.tsx` 中的自定义 Profile 创建/编辑 UI
- `profile.set` RPC 方法（改为只能切换内置 Profile）

### 2.3 Agent 角色

**保留** (Pipeline 核心角色 ~12 个):
- Explorer, Analyst, Planner, Architect
- Debugger, Executor, Verifier
- Code Reviewer (Quality/Security), Test Engineer
- Prometheus (Metis/Momus/Oracle)
- Git Master, Code Simplifier, Researcher

**移除** (~16 个未使用角色):
- Style Reviewer, API Reviewer, Performance Reviewer, Dependency Expert
- Designer, Writer, QA Tester
- Product Manager, UX Researcher, Information Architect, Product Analyst
- 其余 Pipeline 未引用的角色

**影响文件**: `engine/omx-roles.ts`

### 2.4 Evolution Dashboard

**保留的 Tab** (6 个):
1. 流式输出 (StreamingOutput)
2. 日志 (LogPanel + LogSearchBar)
3. 提交记录
4. 教训总结
5. 目标面板 (GoalPanel)
6. Agent 进度 (AgentProgressPanel) + 审批面板 (ApprovalPanel)

**移除的 Tab/组件** (4+2):
- TraceTimeline → 已移除追踪功能
- FeatureBoard → 过度设计
- ExecutionGraph → DAG 可视化非核心
- ErrorStream → 已移除错误监听
- ActivityTimeline → 简化为运行级日志
- PresencePanel → 简化，合并到 GoalPanel

**影响文件**: `EvolutionDashboard.tsx` 中的 Tab 定义和渲染逻辑

### 2.5 Activity Timeline

**简化方向**: 移除完整的审计事件系统（`activity.list` RPC、`activity.created` 通知、per-task 事件记录），改为在 store 中记录运行级别的简单日志（started/completed/stopped）。

**影响文件**:
- `json-rpc/methods.ts`: 移除 `activity.list` 方法
- `session-manager.ts`: 简化 activity 记录
- `store.ts`: 简化 activities 存储逻辑

---

## 三、保留不变的核心模块

| 模块 | 关键文件 |
|------|----------|
| OMX Pipeline 5 阶段执行 | `omx-pipeline.ts`, `omx-phases/*` |
| OMX Team 多 Agent 并行 | `omx-team/*` (完整保留) |
| OMX 执行器 | `omx-executor.ts` |
| OMX State/Gate/Roles | `omx-state.ts`, `omx-gate.ts`, `omx-roles.ts` |
| CC 集成 | `cc-integration/cc-client.ts` |
| Git 操作 | `git/git-manager.ts`, `git/branch-strategy.ts`, `git/worktree-manager.ts` |
| Queue + DAG + 执行池 | `queue-manager.ts`, `dag-scheduler.ts`, `execution-pool.ts` |
| 审批系统 | `approval-gate.ts` |
| Session 管理 | `session-manager.ts` |
| JSON 存储 | `db/store.ts`, `db/store-utils.ts` |
| Share 分享系统 | `db/share-store.ts`, ShareDashboard, SharePanel |
| Skill 管理（完整） | `skills/skill-manager.ts`, `skills/claude-md-generator.ts` |
| Playwright MCP | `lib/playwright-mcp.ts` |
| Plugin 注册（简化版） | `plugins/plugin-registry.ts` |
| 任务向导 | `wizard/wizard-handler.ts`, TaskWizard, QuickCreate |
| Dashboard | MainDashboard, TaskCard, RobotMascot |
| Settings（精简版） | SettingsPage, SkillsManager, PluginManager, GitRemotePanel |

---

## 四、预估影响

| 指标 | 变化 |
|------|------|
| 后端代码 | -~1,400 行 (原 ~10,145) |
| 前端代码 | -~800 行 (原 ~7,950) |
| RPC 方法 | -~15 个 (原 ~70) |
| 推送通知类型 | -~6 种 (原 ~25) |
| shared 类型 | -1 个文件 + 部分类型 |
| 组件数 | -6 个 (原 45) |
| Agent 角色 | -~16 个 (原 28) |

## 五、执行顺序

1. 移除独立模块（remote, omx-research, notification-rules, metrics, tracer, snapshot, readme-generator, error-watcher, task-scheduler）
2. 清理 shared 类型
3. 清理 RPC 方法（json-rpc/methods.ts）
4. 清理 omx-executor.ts 中的引用
5. 移除前端组件（6 个）
6. 简化 Plugin 系统
7. 简化 Profile 配置
8. 简化 Agent 角色
9. 简化 Evolution Dashboard Tab
10. 简化 Activity 系统
11. 运行测试验证
