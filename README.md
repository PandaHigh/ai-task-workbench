# AI Task Workbench (PandaAI)

全自动 AI 任务工具台 — 设定目标，AI 自主拆解任务、执行、评分、提交代码。

## 功能特性

- **智能任务拆解** — 输入高层目标，AI 自动生成子任务并按优先级执行
- **自进化执行循环** — 队列空时自动评估目标完成度，未完成则生成新任务
- **多 Agent 协作** — Planner / Coder / Reviewer / Integrator 角色分工
- **质量评分** — 每个任务自动评分，低于阈值自动 revert
- **自动 Git 管理** — AI 提交代码，格式规范，失败自动回滚
- **实时仪表盘** — WebSocket 推送，流式输出，多用户在线状态
- **任务向导** — 引导式创建任务，支持模板复用
- **分享协作** — 生成分享链接，外部用户可查看进度、提交任务
- **工作目录打包** — 一键下载工作目录为 ZIP
- **Tauri 桌面应用** — 原生窗口体验，自动管理引擎进程

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + TypeScript + Tailwind v4 + Zustand |
| 后端引擎 | Node.js + TypeScript + WebSocket (ws) |
| AI 集成 | Claude CLI (`claude -p` stream-json) |
| 桌面端 | Tauri v2 (Rust) |
| 存储 | JSON 文件（原子写入 tmpfile + rename） |
| Git | simple-git |
| 测试 | Vitest + Testing Library + Playwright |

## 快速开始

### 前置要求

- Node.js >= 18
- [Claude CLI](https://claude.ai/code) 已安装并登录

### 安装

```bash
git clone https://github.com/PandaHigh/ai-task-workbench.git
cd ai-task-workbench
npm install
```

### 启动

```bash
# 启动引擎（终端 1）
cd src-engine && npx tsx src/index.ts

# 启动前端（终端 2）
cd src-ui && npx vite --host --port 1420
```

浏览器打开 `http://localhost:9731` 即可使用。

### Tauri 桌面版

```bash
npm run dev:tauri
```

## 项目结构

```
shared/             共享 TypeScript 类型和枚举
src-engine/
  src/
    engine/         核心引擎（执行器、任务管线、队列管理）
    engine/agents/  多 Agent 系统（角色、编排、审查）
    cc-integration/  Claude CLI 子进程集成
    db/             JSON 文件存储（run、task、commit、lesson）
    git/            Git 操作和 worktree 管理
    json-rpc/       JSON-RPC 方法处理器
    lib/            工具函数（归档、README 生成、重试、错误分类）
    plugins/        MCP 插件管理
    skills/         技能系统
    wizard/         任务创建向导
    ws-server.ts    WebSocket + HTTP 服务器
src-ui/
  src/
    components/
      dashboard/    主仪表盘
      evolution/    执行监控面板（流式输出、Agent 状态、审批）
      wizard/       任务创建向导
      settings/     设置页面
      share/        分享功能
      common/       通用组件
    stores/         Zustand 状态管理
    hooks/          React Hooks
    lib/            前端工具库
src-tauri/          Tauri 桌面应用（Rust）
tests/engine/       后端集成测试
.github/workflows/  CI/CD（测试 + 自动发布）
```

## 架构

```
浏览器 (:9731) ──WebSocket──→ Node.js 引擎 ──spawn──→ claude -p
                                  │
                                  ├── JSON 文件存储
                                  ├── simple-git 操作
                                  └── ZIP 打包 / README 生成
```

引擎通过 WebSocket (JSON-RPC) 与前端通信，通过子进程调用 Claude CLI 执行任务。

## JSON-RPC API

| 方法 | 说明 |
|------|------|
| `run.create / run.list / run.stop` | 运行管理 |
| `run.tasks / run.commits / run.lessons` | 运行数据查询 |
| `task.create / task.start / task.pause / task.cancel` | 任务操作 |
| `task.setTimeout` | 设置任务超时 |
| `queue.list / queue.reorder` | 队列管理 |
| `wizard.start / wizard.chat / wizard.validate` | 任务向导 |
| `config.get / config.set` | 配置管理 |
| `share.create / share.subscribe` | 分享协作 |

HTTP 端点：
- `GET /api/health` — 健康检查
- `GET /api/runs/:id/download` — 下载工作目录 ZIP
- `POST /api/skills/upload` — 上传技能包
- `GET /api/share/:token/:resource` — 分享 API

## 自进化循环

```
1. 从队列取任务（用户定义优先，AI 生成的靠后）
2. 执行任务 → 质量评分 → 通过则 git commit
3. 评分 < 0.6 → 自动 revert + 记录教训
4. 队列空 → 评估目标是否达成
5. 未完成 → 生成新智能任务入队
6. 已完成 → 生成总结报告 + README.md
```

## 稳定性保障

- 最大评估循环 20 次
- 预算上限 $50 USD
- 停滞检测：连续 5 轮进度 < 5% 自动停止
- 僵尸进程：SIGTERM → 5s → SIGKILL
- 原子写入：tmpfile + rename 防崩溃损坏
- WebSocket 心跳：30s ping 检测半开连接
- 优雅关闭：SIGINT/SIGTERM 信号处理

## 数据存储

| 平台 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/ai-task-workbench/` |
| Linux | `~/.local/share/ai-task-workbench/` |
| Windows | `%APPDATA%\ai-task-workbench\` |

每个 run 目录：`tasks.json`, `logs.json`, `commits.json`, `lessons.json`, `scores.json`, `report.json`

## Git 提交规范

- 格式：`[taskId前6位] 任务摘要 #AI commit#`
- 质量评分 < 0.6 自动 revert

## 开发

```bash
# 运行测试
npm run test

# 后端测试
cd src-engine && npx vitest run

# 前端测试
cd src-ui && npx vitest run

# E2E 测试
cd src-ui && npx playwright test

# 构建
npm run build

# 代码检查
npm run lint

# 格式化
npm run format
```

## License

MIT
