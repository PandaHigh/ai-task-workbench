# Skill 管理系统设计

## 目标

让 `claude -p` 子进程在每个任务的 workingDir 中都能使用 skills，不依赖全局插件安装。支持内置 skills（不可删除）和用户自定义 skills（可删除），并在启动任务时动态生成 CLAUDE.md。

## 背景

- Claude Code 从 `<project>/.claude/skills/<name>/SKILL.md` 加载项目级 skills（source: `projectSettings`）
- 当前项目无任何 skill 管理代码，workingDir 准备只做 mkdir + git init
- superpowers 插件的 skills 在 `~/.claude/plugins/cache/` 下，`claude -p` 在其他目录运行时无法发现

## 架构

### 数据层

**`SkillStore`**（`src-engine/src/db/skill-store.ts`）

存储文件：数据目录下 `skills.json`

```ts
interface SkillMeta {
  name: string;           // skill 名称，如 "brainstorming"
  description: string;    // 从 SKILL.md frontmatter 读取
  type: 'builtin' | 'custom';
  dirName: string;        // 目录名，如 "brainstorming"
  createdAt: string;      // ISO-8601
  fileCount: number;      // 包含文件数
}
```

方法：`list(filter?)` / `add(meta)` / `remove(name)` / `findByName(name)`

**文件存储**：

| 类型 | 路径 | 说明 |
|------|------|------|
| 内置 | `src-engine/resources/skills/builtin/<name>/SKILL.md` | 随代码提交，14 个 superpowers skills |
| 自定义 | `<dataDir>/skills/custom/<name>/SKILL.md` | 用户上传解压 |

### Skill 注入

**`SkillManager`**（`src-engine/src/skills/skill-manager.ts`）

```
prepareWorkingDir(workingDir: string): void
  1. mkdir -p <workingDir>/.claude/skills/
  2. 复制内置 skills: resources/skills/builtin/* → <workingDir>/.claude/skills/
  3. 复制自定义 skills: <dataDir>/skills/custom/* → <workingDir>/.claude/skills/
```

**调用时机**：`executor.ts` 的 `executeSingleTask()` 中，在 `CCClient` 执行前调用。

### CLAUDE.md 动态生成

**`generateClaudeMd()`**（`src-engine/src/skills/claude-md-generator.ts`）

从 `TaskContext`（goals, terminationConditions, workingDir 等）生成 CLAUDE.md 写入 `<workingDir>/CLAUDE.md`。

内容结构：
- 任务目标（从 goals 提取）
- 终止条件（从 terminationConditions 提取）
- Git 提交规范
- 注意事项

同样在 `executeSingleTask()` 中、`prepareWorkingDir()` 之后调用。

### RPC 接口

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `skill.list` | `{ type?: 'builtin'\|'custom' }` | `SkillMeta[]` | 列出 skills |
| `skill.upload` | HTTP POST multipart/form-data | `SkillMeta` | 上传 zip 包 |
| `skill.delete` | `{ name: string }` | `{ ok: true }` | 删除自定义 skill |

**上传流程**：
1. 前端选择 .zip 文件
2. HTTP POST 到 `/api/skills/upload`（复用现有 HTTP server，不走 WebSocket）
3. 后端校验：zip 必须包含至少一个 `SKILL.md`（在根目录或一级子目录中）
4. 解压到 `<dataDir>/skills/custom/<name>/`
5. 从 SKILL.md frontmatter 读取 name + description
6. 注册到 SkillStore
7. 广播 `skill.added` 通知给所有 WebSocket 客户端

**删除流程**：
1. 前端调用 `skill.delete` RPC
2. 校验：type !== 'builtin'（内置不可删）
3. 删除 `<dataDir>/skills/custom/<name>/` 目录
4. 从 SkillStore 移除记录
5. 广播 `skill.removed` 通知

### HTTP API

在 `ws-server.ts` 的 `handleHttpRequest` 中新增路由：

- `POST /api/skills/upload` — multipart 文件上传，由 `SkillManager.handleUpload()` 处理

### 前端 UI

**SettingsPage 新增 Skills 管理区域**：

- 两个分区：内置 Skills（只读列表）/ 自定义 Skills（列表 + 操作）
- 内置：显示名称、描述，灰色标记"内置"
- 自定义：显示名称、描述、上传时间，提供删除按钮（确认弹窗）
- 上传：拖拽区域 + 点击选择 .zip 文件，上传进度指示
- 调用 `skill.list` 获取列表，`skill.upload` HTTP 上传，`skill.delete` RPC 删除

### 初始化

**引擎启动时**（`src-engine/src/index.ts`）：
- 扫描 `resources/skills/builtin/` 目录
- 如果 `skills.json` 不存在或内置 skills 数量不匹配，重新注册内置 skills
- 不删除已有的自定义 skills 记录

## 内置 Skills 列表（来自 superpowers 5.1.0）

| 目录名 | 描述 |
|--------|------|
| brainstorming | 创意头脑风暴，将想法转化为设计 |
| dispatching-parallel-agents | 并行分发独立任务给子代理 |
| executing-plans | 执行已制定的实施计划 |
| finishing-a-development-branch | 完成开发分支的集成工作 |
| receiving-code-review | 接收并处理代码审查反馈 |
| requesting-code-review | 请求代码审查 |
| subagent-driven-development | 子代理驱动开发模式 |
| systematic-debugging | 系统化调试流程 |
| test-driven-development | 测试驱动开发 |
| using-git-worktrees | Git worktree 使用 |
| using-superpowers | superpowers 插件使用指南 |
| verification-before-completion | 完成前验证检查 |
| writing-plans | 编写实施计划 |
| writing-skills | 编写新 skills |

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-engine/resources/skills/builtin/` | 新增 | 复制 superpowers 14 个 skills |
| `src-engine/src/db/skill-store.ts` | 新增 | SkillStore 类 |
| `src-engine/src/skills/skill-manager.ts` | 新增 | SkillManager（注入 + 上传 + 删除） |
| `src-engine/src/skills/claude-md-generator.ts` | 新增 | CLAUDE.md 动态生成 |
| `src-engine/src/json-rpc/methods.ts` | 修改 | 注册 skill.list / skill.delete |
| `src-engine/src/ws-server.ts` | 修改 | 新增 /api/skills/upload HTTP 路由 |
| `src-engine/src/engine/executor.ts` | 修改 | 调用 prepareWorkingDir + generateClaudeMd |
| `src-engine/src/index.ts` | 修改 | 启动时初始化内置 skills |
| `shared/src/rpc-types.ts` | 修改 | 新增 EngineMethod 类型 |
| `src-ui/src/components/settings/SettingsPage.tsx` | 修改 | 新增 Skills 管理 UI |
| `src-ui/src/lib/engine-client.ts` | 修改 | 无需改动（已有通用 call 方法） |
