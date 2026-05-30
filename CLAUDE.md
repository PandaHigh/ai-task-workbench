# AI Task Workbench (PandaAI)

## 项目概述
全自动 AI 任务工具台 — 设定目标后 AI 自主拆解任务、执行代码、质量评分、自动 git 提交。支持多 Agent 协作、自进化执行循环、实时监控、分享协作。

## 技术栈
- **前端**: React 18 + TypeScript + Tailwind v4 + Zustand
- **后端引擎**: Node.js (TypeScript) — WebSocket server (ws://localhost:9731)
- **AI 集成**: Claude CLI (`claude -p` stream-json 子进程)
- **桌面端**: Tauri v2 (Rust sidecar)
- **数据存储**: JSON 文件（原子写入 tmpfile+rename）
- **Git**: simple-git（跨平台）
- **测试**: Vitest + Testing Library + Playwright

## 目录结构
```
shared/             共享 TypeScript 类型 (TaskDefinition, ExecutionRun, RPC)
src-engine/
  src/
    engine/         核心引擎 (executor, task-pipeline, queue-manager, session-manager)
    engine/agents/  多 Agent 系统 (agent-role, agent-executor, crew-orchestrator, background-reviewer)
    cc-integration/ Claude CLI 集成 (cc-client)
    db/             JSON 存储 (store, share-store, template-store, skill-store, subscription-store)
    git/            Git 操作 (git-manager, worktree-manager)
    json-rpc/       RPC 方法 (methods)
    lib/            工具 (archive, readme-generator, retry, error-types, tracer)
    plugins/        插件 (mcp-manager, plugin-registry)
    skills/         技能 (skill-manager, claude-md-generator)
    wizard/         任务向导 (wizard-handler)
src-ui/
  src/
    components/
      dashboard/    主仪表盘
      evolution/    执行面板 (StreamingOutput, AgentStatus, ApprovalPanel, TraceTimeline, ErrorStream)
      wizard/       任务创建向导
      settings/     设置页面 (ProfileManager, PluginManager, SkillsManager)
      share/        分享功能
      common/       通用组件 (TaskCreateForm, ConfirmDialog, Toast)
    stores/         Zustand 状态 (task-store, wizard-store, approval-store, evolution-store)
    hooks/          React Hooks (useEngine, useDesktopEngine, useShareView)
src-tauri/          Tauri v2 桌面应用 (Rust sidecar)
tests/engine/       Vitest 集成测试
.github/workflows/  CI/CD
```

## 启动方式
```bash
# 安装
npm install

# 启动引擎
cd src-engine && npx tsx src/index.ts

# 启动前端（另一个终端）
cd src-ui && npx vite --host --port 1420

# Tauri 桌面版
npm run dev:tauri

# 运行测试
npm run test

# 构建
npm run build
```

## 架构
```
浏览器 (:9731) ←──WebSocket (JSON-RPC)──→ Node.js 引擎 (:9731)
                                              │
                                              ├── claude -p 子进程 (stream-json)
                                              ├── JSON 文件存储
                                              ├── simple-git 操作
                                              └── ZIP 打包 / README 生成
```

引擎同时监听 HTTP 和 WebSocket：
- HTTP: `/api/health`, `/api/runs/:id/download`, `/api/skills/upload`, `/api/share/:token/*`
- WebSocket: 所有 JSON-RPC 方法
- 开发模式: 非 API 请求代理到 Vite (localhost:1420)

## JSON-RPC 方法

### 运行管理
`run.create / run.list / run.tasks / run.commits / run.lessons / run.stop`

### 任务操作
`task.create / task.start / task.pause / task.cancel / task.setTimeout`

### 队列管理
`queue.list / queue.reorder`

### 任务向导
`wizard.start / wizard.chat / wizard.validate`

### 配置
`config.get / config.set`

### 分享协作
`share.create / share.subscribe`

## 数据存储路径
- macOS: `~/Library/Application Support/ai-task-workbench/`
- Linux: `~/.local/share/ai-task-workbench/`
- Windows: `%APPDATA%\ai-task-workbench\`

每个 run: `tasks.json`, `logs.json`, `commits.json`, `lessons.json`, `scores.json`, `report.json`

## 自进化循环
1. 从队列取任务（用户定义优先于 AI 生成）
2. 执行任务 → 质量评分（0-1）
3. 评分 >= 0.6 → git commit（格式: `[taskId前6位] 摘要 #AI commit#`）
4. 评分 < 0.6 → git revert + 记录教训
5. 队列空 → CC 评估目标完成度
6. 未完成 → CC 生成新智能任务入队
7. 已完成 → 生成总结报告 + 工作目录 README.md

## 多 Agent 系统
- **Planner**: 分析目标，生成子任务
- **Coder**: 执行代码编写
- **Reviewer**: 审查代码质量
- **Integrator**: 集成变更，解决冲突
- Agent 通过 pipeline 协调，支持并行和串行执行

## 稳定性保障
- 最大评估循环: 20 次
- 预算上限: $50,000 USD
- 停滞检测: 连续 5 轮进度 < 5% 自动停止
- 僵尸进程: SIGTERM → 5s → SIGKILL
- 原子写入: tmpfile + rename 防崩溃数据损坏
- 心跳: WebSocket 30s ping 检测半开连接
- 优雅关闭: SIGINT/SIGTERM 信号处理
- 错误分类: 7 类错误（rate_limit, auth, tool, parse, network, timeout, unknown）+ 分层重试

## 开发规范

### Git 提交
- 格式: `[taskId前6位] 任务摘要 #AI commit#`
- 评分 < 0.6 自动 revert
- 提交消息使用中英文均可，保持一致

### 代码风格
- TypeScript strict mode
- 无未使用的导入和变量
- 后端不使用 express，纯 ws + http
- 前端不使用 CSS Modules，使用 Tailwind v4

### 测试
- 后端: `cd src-engine && npx vitest run`
- 前端: `cd src-ui && npx vitest run`
- E2E: `cd src-ui && npx playwright test`
- 构建验证: `npx tsc --noEmit`（在各子项目目录）
