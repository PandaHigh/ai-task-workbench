# AI Task Workbench — Windows 内网部署指南

## 部署包信息

| 项目 | 值 |
|---|---|
| 版本 | {{VERSION}} |
| 提交 | {{COMMIT}} |
| 打包时间 | {{DATE}} |

## 目录结构

```
ai-task-workbench-deploy/
├── src-engine/
│   └── dist/
│       ├── engine.js          ← Node.js 引擎（已内嵌所有依赖）
│       └── engine.js.map      ← Source Map（调试用，可删除）
├── src-ui/
│   └── dist/                  ← 前端静态文件
│       ├── index.html
│       └── assets/
├── start.bat                  ← 启动引擎
├── stop.bat                   ← 停止引擎
├── status.bat                 ← 查看引擎状态
├── open-browser.bat           ← 打开浏览器
├── .env                       ← 当前配置
├── .env.production            ← 配置模板
├── package.json               ← ESM 模块声明
└── README.md                  ← 本文件
```

## 前置条件

在目标 Windows 机器上需要安装以下软件：

| 软件 | 最低版本 | 用途 | 安装方式 |
|---|---|---|---|
| **Node.js** | 18+ | 运行引擎 | [下载安装包](https://nodejs.org/) |
| **Claude Code CLI** | 最新 | AI 执行任务 | 见下方说明 |
| **Git** | 2.x | 任务版本控制 | [下载安装包](https://git-scm.com/) |

> **注意**: 如果目标机器完全无法联网，需要提前下载 Node.js 和 Git 的离线安装包。

### Claude Code CLI 安装

在有网络的机器上：
```bat
npm install -g @anthropic-ai/claude-code
```

在离线环境中，可以从有网络的机器上打包 npm 全局包后拷贝：
```bat
:: 在有网络的机器上
npm pack @anthropic-ai/claude-code
:: 将 .tgz 文件拷贝到离线机器后
npm install -g ./claude-code-x.x.x.tgz
```

## 快速开始

### 1. 传输部署包

将整个部署文件夹复制到目标 Windows 机器上，例如：

```
C:\ai-task-workbench\
```

### 2. 配置环境

```bat
:: 编辑配置文件（如果需要修改端口等参数）
notepad .env
```

关键配置项：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| ENGINE_PORT | 9731 | 引擎监听端口 |
| ENGINE_HOST | 0.0.0.0 | 监听地址（0.0.0.0 = 所有网卡） |
| NODE_ENV | production | 必须为 production |
| LOG_LEVEL | info | 日志级别 |
| CLAUDE_PATH | claude | Claude CLI 路径 |

### 3. 启动引擎

```bat
:: 双击 start.bat 或在命令行中运行：
start.bat
```

启动后会显示：
```
╔════════════════════════════════════════════════════════╗
║           AI Task Workbench 引擎启动中...              ║
╠════════════════════════════════════════════════════════╣
║  端口: 9731                                            ║
║  地址: 0.0.0.0                                         ║
║  模式: production                                      ║
╚════════════════════════════════════════════════════════╝
```

### 4. 访问界面

浏览器打开：**http://localhost:9731**

或双击 `open-browser.bat`

### 5. 停止引擎

```bat
:: 双击 stop.bat 或在命令行中运行：
stop.bat
```

也可以在运行 start.bat 的窗口中按 **Ctrl+C** 停止。

## 内网多机访问

引擎默认监听 `0.0.0.0`，局域网内其他机器可通过以下方式访问：

```
http://<引擎机器IP>:9731
```

如果需要限制访问，在 `.env` 中设置：

```
ENGINE_HOST=127.0.0.1
```

## 常见问题

### Q: 启动时提示 "Port 9731 is already in use"
**A:** 端口被占用。修改 `.env` 中的 `ENGINE_PORT` 为其他端口，或关闭占用该端口的程序：
```bat
netstat -ano | findstr :9731
taskkill /pid <PID> /f
```

### Q: 启动后浏览器页面空白
**A:** 确认 `src-ui/dist/` 目录下有 `index.html` 文件。如果缺失，说明打包不完整。

### Q: Claude CLI 找不到
**A:** 确认 Claude CLI 已安装并在 PATH 中：
```bat
where claude
```
如果不在 PATH 中，在 `.env` 中设置完整路径：
```
CLAUDE_PATH=C:\Users\用户名\AppData\Roaming\npm\claude.cmd
```

### Q: 任务执行失败 "git not found"
**A:** 确认 Git 已安装：
```bat
git --version
```
如果未安装，下载 [Git for Windows](https://git-scm.com/) 离线安装包。

### Q: 如何以后台服务方式运行
**A:** 使用 Windows 任务计划程序或 [NSSM](https://nssm.cc/) 将 start.bat 注册为服务：
```bat
:: 使用 NSSM 示例
nssm install AiTaskWorkbench "C:\ai-task-workbench\start.bat"
nssm start AiTaskWorkbench
```

### Q: 数据存储在哪里
**A:** Windows 默认数据目录：
```
%APPDATA%\ai-task-workbench\
```
每个任务的运行记录存储在对应子目录中。

### Q: 如何查看日志
**A:** 引擎日志直接输出到启动窗口。如需持久化日志：
```bat
start.bat > engine.log 2>&1
```

## 文件体积参考

| 组件 | 大小（约） |
|---|---|
| 引擎 (engine.js) | ~2-5 MB |
| 前端 (dist/) | ~1-3 MB |
| Source Map | ~5-10 MB（可删除） |
| **总计** | **~3-8 MB**（不含 source map） |

## 技术支持

- 项目仓库：内部 Git 仓库
- 引擎版本：{{VERSION}}
- 构建提交：{{COMMIT}}
