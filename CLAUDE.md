# AI Task Workbench (全自动任务AI工具台)

## 项目概述
全自动 AI 任务工具台 — 管理多个独立 AI 任务，支持自进化执行循环、质量评分、自动 git 提交。

## 技术栈
- **前端**: React 18 + TypeScript + Tailwind v4 (Claude Code 终端风格)
- **后端引擎**: Node.js (TypeScript) — WebSocket server (ws://localhost:9731)
- **CC 集成**: `claude -p` CLI 子进程 (stream-json)
- **数据存储**: JSON 文件（原子写入 tmpfile+rename）
- **状态管理**: Zustand
- **Git**: simple-git（跨平台）

## 目录结构
```
shared/         共享 TypeScript 类型 (TaskDefinition, ExecutionRun, RPC)
src-engine/     Node.js 引擎 (WS server, CC client, executor, queue, store)
src-ui/         React 前端 (dashboard, wizard, evolution, settings)
src-tauri/      Rust 后端 (Phase 5+ Tauri 桌面应用)
tests/engine/   Vitest 集成测试
.github/        GitHub Actions CI
```

## 启动方式
```bash
# 启动引擎
cd src-engine && npx tsx src/index.ts

# 启动前端（另一个终端）
cd src-ui && npx vite --host --port 1420

# 运行测试
cd src-engine && npx vitest run

# 全量构建
npm run build
```

## 架构
```
浏览器 (localhost:1420) ←→ WebSocket (ws://localhost:9731) ←→ Node.js 引擎
                                                            ←→ claude -p 子进程
                                                            ←→ JSON 文件存储
                                                            ←→ git 操作
```

## JSON-RPC 方法
`run.create/run.list/run.tasks/run.commits/run.lessons/run.stop | task.create/task.start/task.pause/task.cancel/task.setTimeout | queue.list/queue.reorder | wizard.start/wizard.chat/wizard.validate | config.get/config.set`

## 数据存储路径
- macOS: `~/Library/Application Support/ai-task-workbench/`
- Linux: `~/.local/share/ai-task-workbench/`
- Windows: `%APPDATA%\ai-task-workbench\`

每个 run: tasks.json, logs.json, commits.json, lessons.json, scores.json, report.json

## Git 提交规范
- 格式: `[taskId前6位] 任务摘要 #AI commit#`
- 质量评分 < 0.6 自动 revert

## 自进化循环
1. 从队列取任务（用户定义优先）
2. 队列空 → CC 评估目标是否达成
3. 未完成 → CC 生成新智能任务入队
4. 已完成 → CC 生成总结报告
5. 每个任务：执行 → 评分 → 通过则 git commit / 不通过则 revert + 记录教训

## 稳定性保障
- 最大评估循环: 20 次
- 预算上限: $50 USD
- 停滞检测: 连续 5 轮进度 < 5% 自动停止
- 僵尸进程: SIGTERM → 5s → SIGKILL
- 原子写入: tmpfile + rename 防崩溃数据损坏
- 心跳: WebSocket 30s ping 检测半开连接
- 优雅关闭: SIGINT/SIGTERM 信号处理
