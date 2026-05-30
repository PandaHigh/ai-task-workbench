# 深度打磨自定义任务功能

## 背景

自定义任务是用户与 AI 任务工具台交互的核心入口。当前有 4 个创建入口（QuickCreate、TaskWizard、AddTaskModal、ShareDashboard），但能力不一致、体验粗糙，且缺少任务编辑和自定义模板功能。

## 设计目标

1. **统一创建体验** — 所有入口支持优先级、超时、模板选择
2. **任务编辑能力** — 排队中的任务可修改内容和优先级
3. **自定义模板系统** — 用户可创建/管理/使用自己的任务模板

---

## 一、统一创建体验

### TaskCreateForm 组件

新建 `src-ui/src/components/common/TaskCreateForm.tsx`，统一的任务创建表单：

- 任务描述 textarea（必填）
- 优先级选择（1-10，默认 5）
- 超时设置（默认使用全局 `defaultTimeout` 配置值）
- 模板快捷选择（显示内置 + 自定义模板列表）
- Ctrl+Enter 快速提交

Props：
```typescript
interface TaskCreateFormProps {
  onSubmit: (params: { content: string; priority: number; timeoutMinutes: number }) => void;
  onCancel?: () => void;
  defaultPriority?: number;
  defaultTimeout?: number;
  templates?: TaskTemplate[];
  submitLabel?: string;
  autoFocus?: boolean;
}
```

### 复用改造

- **AddTaskModal** — 内部替换为 TaskCreateForm
- **QuickCreate** — 任务描述区域集成优先级/超时选择
- **ShareDashboard** — 替换内联添加为 TaskCreateForm
- **Wizard 确认步骤** — 显示优先级/超时编辑

RPC 层无需改动 — `task.create` 和 `run.create` 已支持 `priority` 和 `timeoutMinutes`。

---

## 二、任务编辑能力

### 引擎端

新增 `task.update` RPC 方法：
```typescript
// params: { runId: string, taskId: string, content?: string, priority?: number, timeoutMinutes?: number }
```
- 调用已有的 `store.updateTask()` 写入
- 校验任务状态必须是 `pending` 或 `queued`（执行中/已完成拒绝编辑）

### 前端

- EvolutionDashboard 任务队列中，点击排队任务弹出编辑面板
- 编辑面板复用 TaskCreateForm，预填当前值
- 执行中/已完成任务不可编辑（隐藏编辑按钮）

---

## 三、自定义模板系统

### 引擎端

新建 `src-engine/src/db/template-store.ts`：
- JSON 文件存储（与 shares.json 同级目录）
- 方法：`create / list / update / delete`

模板结构：
```typescript
interface UserTaskTemplate {
  id: string;
  name: string;
  content: string;           // 任务描述模板
  priority: number;
  timeoutMinutes: number;
  isBuiltIn: boolean;        // 内置模板只读
  createdAt: number;
  updatedAt: number;
}
```

RPC 方法：
- `template.create` — `{ name, content, priority?, timeoutMinutes? }`
- `template.list` — 返回内置 + 自定义模板
- `template.update` — `{ id, name?, content?, priority?, timeoutMinutes? }`
- `template.delete` — `{ id }` — 仅允许删除自定义模板

### 前端

SettingsPage 新增"任务模板"标签页：
- 列表展示所有模板（内置置顶，灰色标记"内置"）
- 创建新模板：手动填写或从已有任务"另存为模板"
- 编辑/删除自定义模板
- 内置模板只读（不显示编辑/删除按钮）

TaskCreateForm 中集成模板选择器：
- 下拉或标签形式，选中后自动填充描述/优先级/超时

---

## 改动文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-ui/src/components/common/TaskCreateForm.tsx` | 新建 | 统一任务创建表单组件 |
| `src-ui/src/components/common/TaskCreateForm.test.tsx` | 新建 | 表单组件测试 |
| `src-engine/src/db/template-store.ts` | 新建 | 模板持久化存储 |
| `src-engine/src/json-rpc/methods.ts` | 修改 | 新增 task.update + template CRUD |
| `src-ui/src/components/evolution/AddTaskModal.tsx` | 修改 | 内部替换为 TaskCreateForm |
| `src-ui/src/components/wizard/QuickCreate.tsx` | 修改 | 集成优先级/超时/模板 |
| `src-ui/src/components/share/ShareDashboard.tsx` | 修改 | 替换内联添加为 TaskCreateForm |
| `src-ui/src/components/evolution/EvolutionDashboard.tsx` | 修改 | 添加任务编辑弹窗 |
| `src-ui/src/components/settings/SettingsPage.tsx` | 修改 | 新增任务模板标签页 |
| `src-ui/src/lib/task-templates.ts` | 修改 | 新增模板 RPC 交互方法 |
| `tests/engine/methods.test.ts` | 修改 | 补充 task.update + template 集成测试 |
