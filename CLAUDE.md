# AI Task Workbench (全自动任务AI工具台)

## 项目概述
全自动 AI 任务工具台 - 管理多个独立 AI 任务，支持自进化执行循环、质量评分、自动 git 提交。

## 技术栈
- **桌面框架**: Tauri 2 (Rust)
- **前端**: React 18 + TypeScript + Tailwind v4
- **后端引擎**: Node.js sidecar (TypeScript)
- **CC 集成**: `claude -p` CLI 子进程 (stream-json)
- **数据存储**: JSON 文件（不用数据库）
- **状态管理**: Zustand
- **状态机**: XState v5

## 目录结构
- `shared/` - 共享 TypeScript 类型
- `src-engine/` - Node.js 后端引擎（JSON-RPC server，CC 客户端，执行器）
- `src-ui/` - React 前端（Tauri webview）
- `src-tauri/` - Rust 后端（Tauri 桌面应用）

## 关键架构
- Tauri 通过 stdio JSON-RPC 与 Node.js 引擎通信
- 引擎通过 `claude -p` 子进程调用 Claude Code
- 数据保存在 `~/Library/Application Support/ai-task-workbench/runs/` 目录
- 每个 run 一个目录：tasks.json, logs.json, commits.json, lessons.json, scores.json

## 开发命令
- `cd src-ui && npx vite` - 启动前端开发服务器
- `cd src-engine && npx tsx src/index.ts` - 启动引擎（stdin/stdout JSON-RPC）

## Git 提交规范
- 每个 CC 智能任务完成后自动提交：`[taskId前6位] 任务摘要 #AI commit#`
- 低于质量阈值的任务自动 revert

## 设计风格
- 模仿 Claude Code 终端美学
- 深色主题：背景 #0d1117，主文本 #e6edf3
- 字体：JetBrains Mono
