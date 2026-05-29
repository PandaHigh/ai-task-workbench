# AI Task Workbench 竞品研究与改进建议

## 一、我们系统的定位与现状

**定位**：长时间持续运行的 AI 任务平台，特色是人类与 AI 协作 + 多人协作。

**当前已有功能**：
- 任务队列管理（user_defined 优先、smart_task AI 生成）
- 自进化循环（空队列 → 目标评估 → 智能任务生成 → 执行 → 评分 → commit/revert）
- Claude Code (`claude -p`) 集成执行
- 质量评分系统（4 维度：目标对齐、正确性、完整性、质量）
- 教训系统（失败任务 → 记录教训 → 反馈到后续任务）
- Wizard 对话式目标定义
- Share 分享系统（token URL → 只读/远程操作）
- Subscription 订阅系统（本地引擎订阅远程引擎）
- WebSocket 实时通信（JSON-RPC 2.0）
- 预算控制、停滞检测、僵尸进程清理等稳定性保障

**当前缺失**：
- 无任务执行中的人类审批/干预机制
- 无多人实时协作（当前是单用户系统）
- 无多 Agent 并行执行
- 无跨 session 的特征级别追踪
- 无多渠道通知系统
- 无可视化工作流编排

---

## 二、竞品/类似项目分析

### 1. Anthropic 官方长时间运行 Agent 模式

**来源**：[Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

**核心模式**：Initializer Agent + Coding Agent 双 Agent 架构

| 模式 | 职责 |
|------|------|
| **Initializer Agent** | 首次运行时创建项目结构、生成完整 Feature List（JSON 格式，标记 pass/fail）、初始化 git、写 init.sh |
| **Coding Agent** | 每次只做一个 feature、完成后 git commit + 更新 progress 文件、保证环境处于 clean state |

**关键创新点**：
1. **Feature List 文件**（JSON 格式）— 将大目标分解为 200+ 个可验证的 feature，每个标记 passes: false，coding agent 只能改 passes 状态不能删 feature
2. **跨 context window 状态传递** — 通过 `claude-progress.txt` + git history 让新 session 快速理解当前状态
3. **增量执行** — 强制每次只做一个 feature，防止 agent 贪多嚼不烂
4. **端到端测试** — 使用 Puppeteer MCP 进行浏览器自动化测试，而非仅依赖单元测试
5. **Session 启动清单** — 每次新 session 执行固定步骤：pwd → 读 progress → 读 feature list → 检查 git log → 启动开发服务器 → 验证基础功能

**可借鉴**：
- Feature List 追踪机制（比我们的目标追踪更细粒度）
- Session 启动清单模式（我们的 executor 可以借鉴）
- 端到端自动化验证

---

### 2. Claude Code Agent Teams（Swarm 模式）

**来源**：[Claude Code Agent Teams 官方文档](https://code.claude.com/docs/en/agent-teams)、[Addy Osmani 博客](https://addyosmani.com/blog/claude-code-agent-teams/)

**核心模式**：Lead Agent + Worker Agents，Peer-to-Peer 通信

**关键特性**：
- 一个 session 作为 team lead，协调工作、分配任务
- 多个 worker agents 并行执行子任务
- 支持 100+ 子 agent，数千次 tool calls
- Worker 之间可以 peer-to-peer 通信
- 协调协议存储在 `~/.claude/teams/`

**可借鉴**：
- 多 Agent 并行执行架构
- Lead-Worker 拓扑结构
- Agent 专业化分工（测试 agent、清理 agent、开发 agent）

---

### 3. CrewAI

**来源**：[CrewAI 文档](https://docs.crewai.com/en/concepts/agents)、[CrewAI 官网](https://crewai.com/)

**核心模式**：角色驱动的多 Agent 协作框架

**关键特性**：
- Agent 定义包含 role、goal、backstory（角色背景）
- `human_input` 参数控制哪些任务需要人类审批
- 支持多步骤审批流程（多个审批者）
- 三种流程模式：Sequential（顺序）、Hierarchical（层级）、Async（异步）
- 可与 LangGraph 结合实现审批节点

**可借鉴**：
- 角色化 Agent 定义（而非仅仅是任务描述）
- 可配置的人类审批级别（每个任务粒度）
- 多种流程编排模式

---

### 4. Microsoft AutoGen

**来源**：[AutoGen 文档](https://microsoft.github.io/autogen/0.2/docs/Use-Cases/agent_chat/)、[Microsoft Research](https://www.microsoft.com/en-us/research/project/autogen/)

**核心模式**：对话式多 Agent 框架

**关键特性**：
- `UserProxyAgent` 代表人类参与对话
- 三种人类输入模式：`ALWAYS`（每次都问）、`TERMINATE`（仅在终止时）、`NEVER`（全自动）
- Agent 之间通过对话协作
- AutoGen Studio 无代码界面

**可借鉴**：
- **三种自治级别的概念**（非常值得借鉴，我们可以引入类似的模式）
- 对话式协作范式
- UserProxy 模式（人类作为 Agent 参与协作）

---

### 5. Dify

**来源**：[Dify 官网](https://dify.ai/)、[Dify GitHub](https://github.com/langgenius/dify)

**核心模式**：可视化 LLM 工作流编排平台

**关键特性**：
- 拖拽式工作流编辑器
- 多 LLM 支持
- 内置 RAG 管道
- 实时多人协作编辑（开发中，Issue #3857）
- 可观测性（observability）
- 丰富的预置模板

**可借鉴**：
- 可视化工作流编辑
- 多 LLM 支持（不绑定单一模型）
- 可观测性面板

---

### 6. OpenHands

**来源**：[OpenHands 官网](https://openhands.dev/)、[OpenHands Blog](https://www.openhands.dev/blog/20251202-agents-in-the-outer-loop)

**核心模式**：云编码 Agent + PR 审查工作流

**关键特性**：
- Agent 自动开 PR，人类审查 PR
- "Outer Loop" 模式：Agent 在人类现有工作流中自动工作
- 吞吐量上限（agent 输出不能超过人类审查能力）
- Approval Gate 模式（PreToolUse hooks 暂停 agent）

**可借鉴**：
- **吞吐量上限概念**（防止 agent 生成过多人类来不及审查的内容）
- PR 审查工作流（自然融入现有开发流程）
- Approval Gate / 检查点机制

---

### 7. qlaude / claude-code-queue

**来源**：[qlaude on Medium](https://agentnativedev.medium.com/qlaude-queue-based-claude-code-automation-with-telegram-control-778de887f465)、[claude-code-queue](https://github.com/JCSnap/claude-code-queue)

**核心模式**：队列化 Claude Code 自动化

**关键特性**：
- Token 限制重置后自动恢复执行
- Per-task 模型路由（不同任务用不同模型）
- Telegram 控制界面（远程监控+控制）
- 显式 session 边界管理

**可借鉴**：
- **多渠道通知**（Telegram、Slack、邮件等）
- **Per-task 模型选择**（不同任务可以用不同 AI 模型）
- Session 边界管理

---

### 8. Google A2A Protocol

**来源**：[Google Developers Blog](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)

**核心模式**：Agent 间互操作协议

**关键特性**：
- 标准化的 agent 间通信协议
- 安全信息交换
- 跨平台 agent 协调

**可借鉴**：
- Agent 互操作性标准（未来可以让我们的平台与其他 Agent 系统对接）

---

## 三、核心差距分析

| 能力维度 | 我们现状 | 行业最佳实践 | 差距 |
|---------|---------|------------|------|
| **人类干预** | 仅能暂停/恢复/取消 | 检查点审批、Approval Gate、可配置自治级别 | 🔴 大 |
| **多人协作** | Share 只读+基础写入 | 实时协作、角色权限、活动流 | 🔴 大 |
| **多 Agent 并行** | 串行执行 | Lead-Worker、Swarm、角色分工 | 🔴 大 |
| **特征级追踪** | 任务级评分 | Feature List（200+ feature 的 pass/fail） | 🟡 中 |
| **通知系统** | 仅 WebSocket 广播 | 多渠道（Telegram/Slack/邮件）+ 规则引擎 | 🟡 中 |
| **可视化工作流** | 无 | 拖拽式 DAG 编辑器 | 🟡 中 |
| **多模型支持** | 仅 Claude Code | 多 LLM 路由 | 🟡 中 |
| **可观测性** | 基础日志 | 结构化 trace、性能面板 | 🟢 小 |

---

## 四、改进建议（按优先级排序）

### P0：人类-AI 协作核心能力

#### 4.1 可配置自治级别（借鉴 AutoGen）

引入三个自治级别，每个 run 可独立配置：

```typescript
// shared/src/task-types.ts 新增
type AutonomyLevel =
  | 'supervised'    // ALWAYS: 每个任务执行前需人类审批
  | 'assisted'      // TERMINATE: 自动执行，关键节点需人类确认
  | 'autonomous';   // NEVER: 全自动执行（当前默认行为）
```

**实现要点**：
- `supervised`：任务出队后不立即执行，等待人类 approve/reject/edit
- `assisted`：任务执行到关键节点（如文件修改、git commit 前）暂停等待确认
- `autonomous`：当前行为，自动执行一切
- UI 增加"审批面板"：显示待审批任务、推荐操作、一键 approve/reject

#### 4.2 检查点与 Approval Gate（借鉴 OpenHands）

在任务执行流程中引入检查点：

```typescript
type CheckpointConfig = {
  beforeCommit: boolean;     // git commit 前暂停
  afterScoring: boolean;     // 评分后暂停（质量 < 阈值时）
  beforeRevert: boolean;     // revert 前暂停（让人类决定是否真的回滚）
  onNewSmartTask: boolean;   // AI 生成新任务后暂停（让人类确认方向正确）
  onGoalEval: boolean;       // 目标评估后暂停（让人类查看进度）
};
```

**实现要点**：
- executor 在对应节点广播 `approval.requested` 通知
- WebSocket 客户端弹出审批对话框
- 支持超时自动处理（如 30 分钟无人响应则按默认策略继续）
- 审批记录写入 logs.json

#### 4.3 实时干预能力

在任务执行过程中允许人类介入：

- **实时查看**：AI 正在执行的命令、正在编辑的文件（流式输出）
- **实时注入**：人类可以在任务执行中发送补充指令
- **实时接管**：人类可以暂停 AI，手动操作后让 AI 继续
- **实时编辑**：修改 AI 即将 commit 的 diff

**实现要点**：
- 扩展 CCClient 支持双向 stdin 交互
- 新增 `task.intervene` RPC 方法
- 新增 `task.inject` RPC 方法（注入补充 prompt）
- UI 增加"实时终端"面板

---

### P1：多人协作能力

#### 4.4 用户身份与权限（借鉴 Dify）

```typescript
type UserRole = 'owner' | 'collaborator' | 'viewer';

type RunPermission = {
  userId: string;
  role: UserRole;
  // 细粒度权限
  canAddTask: boolean;
  canApproveTask: boolean;
  canEditQueue: boolean;
  canStartStop: boolean;
  canManageShare: boolean;
};
```

**实现要点**：
- 轻量级认证（API Key 或简单密码，不需要完整的 OAuth）
- WebSocket 连接携带身份信息
- 每个操作根据权限检查
- 当前 Share token 演变为带权限的邀请链接

#### 4.2 实时协作感知

- **在线状态**：显示当前有哪些人正在查看/操作
- **操作流**：实时显示所有人的操作（谁添加了任务、谁审批了、谁暂停了）
- **协作光标**：在队列拖拽、任务编辑时显示其他人的操作
- **评论系统**：任务上可以添加评论/讨论

**实现要点**：
- 新增 `presence.*` 通知类型
- 新增 `comment.*` RPC 方法
- 扩展 WebSocket 广播增加 userId
- 数据存储新增 comments.json

#### 4.3 活动时间线

```typescript
type ActivityEvent = {
  id: string;
  timestamp: number;
  userId: string;
  action: string;          // 'task.created' | 'task.approved' | 'run.paused' | ...
  details: Record<string, unknown>;
  runId: string;
};
```

**实现要点**：
- 所有关键操作记录为 ActivityEvent
- 存储在 activities.json
- UI 显示活动时间线（类似 GitHub 活动流）
- 可按用户/时间/类型过滤

---

### P2：多 Agent 并行与专业化

#### 4.4 角色化 Agent（借鉴 CrewAI）

```typescript
type AgentRole = {
  id: string;
  name: string;             // 如 "代码实现", "测试验证", "代码审查"
  specialization: string;   // 专长描述
  systemPrompt: string;     // 定制化的 system prompt
  allowedTools?: string[];  // 可用的工具限制
  model?: string;           // 使用的模型
};

type TaskDefinition = {
  ...existing fields...
  assignedRoleId?: string;  // 指定由哪个角色执行
};
```

**实现要点**：
- 预置角色模板：Developer、Tester、Reviewer、Architect
- 每个任务可以指定角色
- 角色影响 system prompt 和可用工具
- 支持自定义角色

#### 4.5 多 Agent 并行执行（借鉴 Claude Code Agent Teams）

```typescript
type ExecutionMode =
  | 'sequential'   // 当前模式：逐个执行
  | 'parallel'     // 多任务并行
  | 'swarm';       // Lead-Worker 模式
```

**实现要点**：
- `parallel`：多个 executor 实例并行运行（需考虑 git 冲突）
- `swarm`：一个 lead agent 分配任务，多个 worker agent 并行执行
- 每个 worker 有独立的 worktree（git worktree 隔离）
- Lead agent 负责合并和冲突解决

---

### P3：增强可观测性与通知

#### 4.6 多渠道通知系统（借鉴 qlaude）

```typescript
type NotificationRule = {
  id: string;
  event: string;            // 'task.completed' | 'task.failed' | 'approval.requested' | ...
  channel: 'websocket' | 'email' | 'telegram' | 'slack' | 'webhook';
  config: Record<string, string>;  // channel-specific 配置
  enabled: boolean;
};
```

**实现要点**：
- 基于规则引擎的通知系统
- 事件 → 规则匹配 → 渠道发送
- 支持 webhook 自定义集成
- 支持静默时段（如夜间不发送非紧急通知）

#### 4.7 Feature 级追踪（借鉴 Anthropic Harness）

将当前的目标/任务两级体系扩展为三级：

```
Run Goal → Features (feature_list.json) → Tasks
```

**实现要点**：
- 首次运行时 AI 生成完整 Feature List（类似 Initializer Agent）
- 每个 feature 有独立的 pass/fail 状态
- 任务执行后自动更新关联 feature 的状态
- UI 展示 feature 完成进度看板

---

### P4：可视化与体验增强

#### 4.8 任务 DAG 可视化

- 任务间依赖关系图（DAG）
- 拖拽编排任务执行顺序
- 可视化当前执行路径和并行分支

#### 4.9 Per-task 模型路由

```typescript
type ModelRoute = {
  taskType: 'implementation' | 'testing' | 'review' | 'documentation';
  model: 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
};
```

不同类型的任务使用不同成本/能力的模型。

---

## 五、实施路线图

| 阶段 | 内容 | 预计工作量 |
|------|------|----------|
| **Phase 1** | 可配置自治级别 + Approval Gate + 实时干预 | 2-3 周 |
| **Phase 2** | 用户身份权限 + 实时协作感知 + 活动时间线 | 2-3 周 |
| **Phase 3** | 角色化 Agent + 多 Agent 并行执行 | 3-4 周 |
| **Phase 4** | 多渠道通知 + Feature 级追踪 | 1-2 周 |
| **Phase 5** | DAG 可视化 + Per-task 模型路由 | 1-2 周 |

---

## 六、差异化定位

与上述所有项目相比，我们的独特定位是：

1. **长时间 + 人类协作** — Anthropic harness 是纯自动化的，我们加入人类审批
2. **任务级粒度** — CrewAI/AutoGen 侧重 Agent 间对话，我们侧重任务生命周期管理
3. **质量闭环** — 自动评分 + git commit/revert + 教训反馈，其他项目没有这么完整的质量保障
4. **分享 + 订阅** — 独特的分布式协作模式（一个引擎订阅另一个引擎）

**核心差异化口号**：「人类可介入的长时间 AI 任务平台 — 让 AI 自主工作，但在需要时随时可以接管」

---

## 七、参考资源

- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Claude Code Agent Teams 官方文档](https://code.claude.com/docs/en/agent-teams)
- [Addy Osmani: Claude Code Agent Teams](https://addyosmani.com/blog/claude-code-agent-teams/)
- [CrewAI 官方文档](https://docs.crewai.com/en/concepts/agents)
- [Microsoft AutoGen](https://microsoft.github.io/autogen/0.2/docs/Use-Cases/agent_chat/)
- [Dify 官网](https://dify.ai/)
- [OpenHands 官网](https://openhands.dev/)
- [qlaude: Queue-based Claude Code Automation](https://agentnativedev.medium.com/qlaude-queue-based-claude-code-automation-with-telegram-control-778de887f465)
- [claude-code-queue](https://github.com/JCSnap/claude-code-queue)
- [Google A2A Protocol](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview)
- [How to Build Human-in-the-Loop Approval Gates](https://codeongrass.com/blog/how-to-build-human-in-the-loop-approval-gates-ai-coding-agents/)
- [From Tasks to Swarms: Agent Teams in Claude Code](https://alexop.dev/posts/from-tasks-to-swarms-agent-teams-in-claude-code/)
- [Nonstop Agent (GitHub)](https://github.com/seolcoding/nonstop-agent)
