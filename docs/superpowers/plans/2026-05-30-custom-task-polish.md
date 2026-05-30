# 自定义任务打磨 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一任务创建体验、添加任务编辑能力、实现自定义模板系统

**Architecture:** 引擎端新增 TemplateStore（JSON 文件）和 task.update RPC；前端新建 TaskCreateForm 统一表单组件，改造 4 个创建入口，SettingsPage 新增模板管理标签页

**Tech Stack:** React 18 + TypeScript + Zustand（前端）、Node.js + Vitest（引擎）、JSON 文件存储（模板持久化）

---

## Task 1: 引擎 — TemplateStore

**Files:**
- Create: `src-engine/src/db/template-store.ts`

- [ ] **Step 1: 创建 TemplateStore**

```typescript
// src-engine/src/db/template-store.ts
import path from "path";
import { randomUUID } from "crypto";
import { getDataDir, ensureDir, readJsonFile, writeJsonFile } from "./store-utils.js";

export interface UserTaskTemplate {
  id: string;
  name: string;
  content: string;
  priority: number;
  timeoutMinutes: number;
  isBuiltIn: boolean;
  createdAt: number;
  updatedAt: number;
}

export class TemplateStore {
  private filePath: string;

  constructor(customDataDir?: string) {
    const dataDir = customDataDir || getDataDir();
    ensureDir(dataDir);
    this.filePath = path.join(dataDir, "templates.json");
  }

  create(params: { name: string; content: string; priority?: number; timeoutMinutes?: number }): UserTaskTemplate {
    const templates = this.readAll();
    const now = Date.now();
    const tpl: UserTaskTemplate = {
      id: randomUUID(),
      name: params.name,
      content: params.content,
      priority: params.priority ?? 5,
      timeoutMinutes: params.timeoutMinutes ?? 60,
      isBuiltIn: false,
      createdAt: now,
      updatedAt: now,
    };
    templates.push(tpl);
    this.writeAll(templates);
    return tpl;
  }

  list(): UserTaskTemplate[] {
    return this.readAll();
  }

  update(id: string, updates: Partial<Pick<UserTaskTemplate, "name" | "content" | "priority" | "timeoutMinutes">>): UserTaskTemplate | undefined {
    const templates = this.readAll();
    const idx = templates.findIndex((t) => t.id === id);
    if (idx < 0) return undefined;
    if (templates[idx].isBuiltIn) throw new Error("Cannot modify built-in template");
    Object.assign(templates[idx], updates, { updatedAt: Date.now() });
    this.writeAll(templates);
    return templates[idx];
  }

  delete(id: string): boolean {
    const templates = this.readAll();
    const idx = templates.findIndex((t) => t.id === id);
    if (idx < 0) return false;
    if (templates[idx].isBuiltIn) throw new Error("Cannot delete built-in template");
    templates.splice(idx, 1);
    this.writeAll(templates);
    return true;
  }

  private readAll(): UserTaskTemplate[] {
    return readJsonFile<UserTaskTemplate[]>(this.filePath, []);
  }

  private writeAll(templates: UserTaskTemplate[]): void {
    writeJsonFile(this.filePath, templates);
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `cd src-engine && npx tsc --noEmit src/db/template-store.ts 2>&1 | head -5`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src-engine/src/db/template-store.ts
git commit -m "feat(engine): add TemplateStore for user task templates"
```

---

## Task 2: 引擎 — task.update + template CRUD RPC 方法

**Files:**
- Modify: `src-engine/src/json-rpc/methods.ts`

- [ ] **Step 1: 导入 TemplateStore 并初始化实例**

在 `methods.ts` 顶部导入区域添加：

```typescript
import { TemplateStore } from "../db/template-store.js";
```

在已有的 `const shareStore = new ShareStore();` 行后添加：

```typescript
const templateStore = new TemplateStore();
```

在 `export { store, shareStore, subscriptionStore, queueManager, skillStore, skillManager };` 行中添加 `templateStore`。

- [ ] **Step 2: 添加 task.update 方法**

在 `"task.setTimeout"` 方法块之后添加：

```typescript
"task.update": async (params) => {
  const runId = requireString(params, "runId");
  validateRunId(runId);
  const taskId = requireString(params, "taskId");
  const task = store.getTask(runId, taskId);
  if (!task) throw new RpcValidationError(`Task not found: ${taskId}`);
  if (!["pending", "queued"].includes(task.status)) {
    throw new RpcValidationError(`Cannot edit task with status: ${task.status}`);
  }
  const updates: Partial<TaskDefinition> = {};
  if (typeof params.content === "string" && params.content.trim()) updates.content = params.content.trim();
  if (typeof params.priority === "number") updates.priority = params.priority;
  if (typeof params.timeoutMinutes === "number") updates.timeoutMinutes = params.timeoutMinutes;
  if (Object.keys(updates).length === 0) throw new RpcValidationError("No valid fields to update");
  store.updateTask(runId, taskId, updates);
  const updated = store.getTask(runId, taskId);
  if (updates.priority !== undefined) {
    notify("queue.updated", { runId, queue: queueManager.peekNext(runId) });
  }
  return updated;
},
```

- [ ] **Step 3: 添加 template CRUD 方法**

在 `"share.revoke"` 方法块之后添加：

```typescript
"template.create": async (params) => {
  const name = requireNonEmptyString(params, "name");
  const content = requireNonEmptyString(params, "content");
  return templateStore.create({
    name,
    content,
    priority: typeof params.priority === "number" ? params.priority : undefined,
    timeoutMinutes: typeof params.timeoutMinutes === "number" ? params.timeoutMinutes : undefined,
  });
},

"template.list": async () => {
  return templateStore.list();
},

"template.update": async (params) => {
  const id = requireString(params, "id");
  const updates: Record<string, unknown> = {};
  if (typeof params.name === "string") updates.name = params.name;
  if (typeof params.content === "string") updates.content = params.content;
  if (typeof params.priority === "number") updates.priority = params.priority;
  if (typeof params.timeoutMinutes === "number") updates.timeoutMinutes = params.timeoutMinutes;
  const result = templateStore.update(id, updates);
  if (!result) throw new RpcValidationError("Template not found");
  return result;
},

"template.delete": async (params) => {
  const id = requireString(params, "id");
  const deleted = templateStore.delete(id);
  if (!deleted) throw new RpcValidationError("Template not found");
  return { deleted: true };
},
```

- [ ] **Step 4: 验证编译**

Run: `cd src-engine && npx tsc --noEmit 2>&1 | head -5`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add src-engine/src/json-rpc/methods.ts
git commit -m "feat(engine): add task.update + template CRUD RPC methods"
```

---

## Task 3: 引擎集成测试 — task.update + template CRUD

**Files:**
- Modify: `tests/engine/methods.test.ts`

- [ ] **Step 1: 在 methods.test.ts 的 beforeEach 中添加 TemplateStore mock**

找到已有的 `vi.doMock("../../src-engine/src/db/share-store.js"` 块，在其后添加相同模式的 TemplateStore mock：

```typescript
vi.doMock("../../src-engine/src/db/template-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src-engine/src/db/template-store.js")>();
  return {
    TemplateStore: vi.fn(function (this: unknown) {
      return new actual.TemplateStore(testDir);
    }),
  };
});
```

- [ ] **Step 2: 添加 task.update 测试**

在文件末尾（最后一个 `describe` 块之后）添加：

```typescript
describe("task.update", () => {
  it("should update task content", async () => {
    const run = await createRun();
    const task = await methodHandlers["task.create"]({ runId: run.id, content: "original" }) as Record<string, unknown>;
    const updated = await methodHandlers["task.update"]({ runId: run.id, taskId: task.id, content: "updated content" }) as Record<string, unknown>;
    expect(updated.content).toBe("updated content");
  });

  it("should update task priority", async () => {
    const run = await createRun();
    const task = await methodHandlers["task.create"]({ runId: run.id, content: "test" }) as Record<string, unknown>;
    const updated = await methodHandlers["task.update"]({ runId: run.id, taskId: task.id, priority: 8 }) as Record<string, unknown>;
    expect(updated.priority).toBe(8);
  });

  it("should reject update for non-editable status", async () => {
    const run = await createRun();
    const task = await methodHandlers["task.create"]({ runId: run.id, content: "test" }) as Record<string, unknown>;
    store.updateTask(run.id, task.id as string, { status: "running" });
    await expect(
      methodHandlers["task.update"]({ runId: run.id, taskId: task.id, content: "nope" }),
    ).rejects.toThrow("Cannot edit task");
  });

  it("should reject unknown task", async () => {
    const run = await createRun();
    await expect(
      methodHandlers["task.update"]({ runId: run.id, taskId: "nonexistent", content: "x" }),
    ).rejects.toThrow("Task not found");
  });
});

describe("template CRUD", () => {
  it("should create and list templates", async () => {
    await methodHandlers["template.create"]({ name: "My Template", content: "Do something", priority: 3 });
    const list = await methodHandlers["template.list"]({}) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("My Template");
    expect(list[0].priority).toBe(3);
    expect(list[0].isBuiltIn).toBe(false);
  });

  it("should update template", async () => {
    const tpl = await methodHandlers["template.create"]({ name: "Original", content: "content" }) as Record<string, unknown>;
    const updated = await methodHandlers["template.update"]({ id: tpl.id, name: "Updated", priority: 7 }) as Record<string, unknown>;
    expect(updated.name).toBe("Updated");
    expect(updated.priority).toBe(7);
  });

  it("should delete template", async () => {
    const tpl = await methodHandlers["template.create"]({ name: "ToDelete", content: "x" }) as Record<string, unknown>;
    const result = await methodHandlers["template.delete"]({ id: tpl.id });
    expect(result).toEqual({ deleted: true });
    const list = await methodHandlers["template.list"]({}) as Array<unknown>;
    expect(list).toHaveLength(0);
  });

  it("should reject deleting unknown template", async () => {
    await expect(
      methodHandlers["template.delete"]({ id: "nonexistent" }),
    ).rejects.toThrow("Template not found");
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `cd src-engine && npx vitest run ../tests/engine/methods.test.ts 2>&1 | tail -15`
Expected: 所有新增测试通过

- [ ] **Step 4: 提交**

```bash
git add tests/engine/methods.test.ts
git commit -m "test(engine): add integration tests for task.update and template CRUD"
```

---

## Task 4: 前端 — TaskCreateForm 统一表单组件

**Files:**
- Create: `src-ui/src/components/common/TaskCreateForm.tsx`
- Create: `src-ui/src/components/common/TaskCreateForm.test.tsx`

- [ ] **Step 1: 创建 TaskCreateForm 组件**

```typescript
// src-ui/src/components/common/TaskCreateForm.tsx
import { useState, useEffect } from "react";

interface TaskTemplateItem {
  id: string;
  name: string;
  content: string;
  priority: number;
  timeoutMinutes: number;
  isBuiltIn?: boolean;
}

interface TaskCreateFormProps {
  onSubmit: (params: { content: string; priority: number; timeoutMinutes: number }) => void;
  onCancel?: () => void;
  defaultPriority?: number;
  defaultTimeout?: number;
  templates?: TaskTemplateItem[];
  submitLabel?: string;
  autoFocus?: boolean;
  initialContent?: string;
}

export function TaskCreateForm({
  onSubmit,
  onCancel,
  defaultPriority = 5,
  defaultTimeout = 60,
  templates = [],
  submitLabel = "确认",
  autoFocus = true,
  initialContent = "",
}: TaskCreateFormProps) {
  const [content, setContent] = useState(initialContent);
  const [priority, setPriority] = useState(defaultPriority);
  const [timeoutMinutes, setTimeoutMinutes] = useState(defaultTimeout);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    setContent(initialContent);
    setPriority(defaultPriority);
    setTimeoutMinutes(defaultTimeout);
  }, [initialContent, defaultPriority, defaultTimeout]);

  const canSubmit = content.trim().length > 0;

  const applyTemplate = (tpl: TaskTemplateItem) => {
    setContent(tpl.content);
    setPriority(tpl.priority);
    setTimeoutMinutes(tpl.timeoutMinutes);
    setShowTemplates(false);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ content: content.trim(), priority, timeoutMinutes });
  };

  return (
    <div className="space-y-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="描述你的任务..."
        rows={4}
        className="w-full px-3 py-2 rounded-lg text-xs outline-none resize-none"
        style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "2px solid var(--blue)" }}
        autoFocus={autoFocus}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (canSubmit) handleSubmit(); }
          if (e.key === "Escape") onCancel?.();
        }}
      />

      {templates.length > 0 && (
        <div>
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="text-[10px] px-2 py-1 rounded"
            style={{ color: "var(--text-secondary)", background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}
          >
            {showTemplates ? "收起模板" : "使用模板"}
          </button>
          {showTemplates && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {templates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => applyTemplate(tpl)}
                  className="px-2 py-1 rounded text-[10px]"
                  style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-4 text-[10px]" style={{ color: "var(--text-secondary)" }}>
        <div className="flex items-center gap-1">
          <span>优先级</span>
          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="px-1.5 py-0.5 rounded text-[10px] outline-none"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
          >
            {Array.from({ length: 10 }, (_, i) => (
              <option key={i + 1} value={i + 1}>P{i + 1}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span>超时</span>
          <select
            value={timeoutMinutes}
            onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
            className="px-1.5 py-0.5 rounded text-[10px] outline-none"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
          >
            {[15, 30, 60, 90, 120, 180].map((v) => (
              <option key={v} value={v}>{v}分钟</option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>Ctrl+Enter 快速提交</p>

      <div className="flex gap-2 justify-end">
        {onCancel && (
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>取消</button>
        )}
        <button onClick={handleSubmit} disabled={!canSubmit} className="px-4 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: "var(--green)", color: "#fff" }}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 TaskCreateForm 测试**

```typescript
// src-ui/src/components/common/TaskCreateForm.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskCreateForm } from "./TaskCreateForm";

describe("TaskCreateForm", () => {
  const mockOnSubmit = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render with default values", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} />);
    expect(screen.getByPlaceholderText("描述你的任务...")).toBeInTheDocument();
    expect(screen.getByText("确认")).toBeDisabled();
  });

  it("should enable submit when text is entered", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} />);
    fireEvent.change(screen.getByPlaceholderText("描述你的任务..."), { target: { value: "New task" } });
    expect(screen.getByText("确认")).not.toBeDisabled();
  });

  it("should call onSubmit with content, priority, timeout", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} defaultPriority={3} defaultTimeout={120} />);
    fireEvent.change(screen.getByPlaceholderText("描述你的任务..."), { target: { value: "My task" } });
    fireEvent.click(screen.getByText("确认"));
    expect(mockOnSubmit).toHaveBeenCalledWith({ content: "My task", priority: 3, timeoutMinutes: 120 });
  });

  it("should call onCancel when clicking cancel", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
    fireEvent.click(screen.getByText("取消"));
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it("should not show cancel button when no onCancel", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} />);
    expect(screen.queryByText("取消")).not.toBeInTheDocument();
  });

  it("should show template selector when templates provided", () => {
    const templates = [
      { id: "t1", name: "Bug Fix", content: "Fix bug", priority: 3, timeoutMinutes: 30 },
    ];
    render(<TaskCreateForm onSubmit={mockOnSubmit} templates={templates} />);
    expect(screen.getByText("使用模板")).toBeInTheDocument();
    fireEvent.click(screen.getByText("使用模板"));
    expect(screen.getByText("Bug Fix")).toBeInTheDocument();
  });

  it("should apply template on click", () => {
    const templates = [
      { id: "t1", name: "Bug Fix", content: "Fix the bug", priority: 7, timeoutMinutes: 90 },
    ];
    render(<TaskCreateForm onSubmit={mockOnSubmit} templates={templates} />);
    fireEvent.click(screen.getByText("使用模板"));
    fireEvent.click(screen.getByText("Bug Fix"));
    expect(screen.getByPlaceholderText("描述你的任务...")).toHaveValue("Fix the bug");
    fireEvent.click(screen.getByText("确认"));
    expect(mockOnSubmit).toHaveBeenCalledWith({ content: "Fix the bug", priority: 7, timeoutMinutes: 90 });
  });

  it("should use custom submit label", () => {
    render(<TaskCreateForm onSubmit={mockOnSubmit} submitLabel="添加" />);
    expect(screen.getByText("添加")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 运行测试**

Run: `cd src-ui && npx vitest run src/components/common/TaskCreateForm.test.tsx`
Expected: 7 tests pass

- [ ] **Step 4: 提交**

```bash
git add src-ui/src/components/common/TaskCreateForm.tsx src-ui/src/components/common/TaskCreateForm.test.tsx
git commit -m "feat(ui): add TaskCreateForm unified task creation component"
```

---

## Task 5: 前端 — 改造 AddTaskModal 使用 TaskCreateForm

**Files:**
- Modify: `src-ui/src/components/evolution/AddTaskModal.tsx`
- Modify: `src-ui/src/components/evolution/AddTaskModal.test.tsx`

- [ ] **Step 1: 重写 AddTaskModal，内部使用 TaskCreateForm**

将 `AddTaskModal.tsx` 替换为：

```typescript
import { useState, useEffect, useCallback } from "react";
import { TaskCreateForm } from "../common/TaskCreateForm";
import type { TaskDefinition } from "@ai-workbench/shared";

interface UserTaskTemplate {
  id: string;
  name: string;
  content: string;
  priority: number;
  timeoutMinutes: number;
  isBuiltIn?: boolean;
}

interface AddTaskModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string, priority: number, timeoutMinutes?: number) => void;
  defaultPriority?: number;
  defaultTimeout?: number;
  call?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

export function AddTaskModal({ open, onClose, onSubmit, defaultPriority = 5, defaultTimeout = 60, call }: AddTaskModalProps) {
  const [templates, setTemplates] = useState<UserTaskTemplate[]>([]);

  const loadTemplates = useCallback(async () => {
    if (!call) return;
    try {
      const list = await call("template.list", {}) as UserTaskTemplate[];
      setTemplates(list);
    } catch { /* ignore */ }
  }, [call]);

  useEffect(() => {
    if (open) loadTemplates();
  }, [open, loadTemplates]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
      role="dialog"
    >
      <div
        className="p-6 w-full max-w-md"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "12px", animation: "slideUp 0.2s ease-out" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold mb-3">添加任务</h3>
        <TaskCreateForm
          onSubmit={({ content, priority, timeoutMinutes }) => {
            onSubmit(content, priority, timeoutMinutes);
          }}
          onCancel={onClose}
          defaultPriority={defaultPriority}
          defaultTimeout={defaultTimeout}
          templates={templates}
          autoFocus
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 更新 AddTaskModal 测试**

更新 `AddTaskModal.test.tsx` 中的 `onSubmit` 调用签名。现有测试中 `mockOnSubmit` 接受 `(text, priority)` 两个参数，新版本接受 `(text, priority, timeoutMinutes?)` 三个参数。更新 mock 和断言：

```typescript
// 将所有 mockOnSubmit 调用的断言从两个参数改为三个
// 例如：expect(mockOnSubmit).toHaveBeenCalledWith("Fix the bug", 3)
// 改为：expect(mockOnSubmit).toHaveBeenCalledWith("Fix the bug", 3, expect.any(Number))
```

- [ ] **Step 3: 运行测试**

Run: `cd src-ui && npx vitest run src/components/evolution/AddTaskModal.test.tsx`
Expected: 所有测试通过

- [ ] **Step 4: 更新 EvolutionDashboard 中 handleAddTask 签名**

在 `EvolutionDashboard.tsx` 中，找到 `handleAddTask` 函数（约第 289 行），添加 `timeoutMinutes` 参数传递：

```typescript
const handleAddTask = async (text?: string, priority?: number, timeoutMinutes?: number) => {
  const content = (text ?? newTaskText).trim();
  const prio = priority ?? newTaskPriority;
  if (!runId || !content) return;
  try {
    await call("task.create", { runId, content, type: "user_defined", priority: prio, timeoutMinutes });
    // ... rest unchanged
```

并更新 AddTaskModal 的 onSubmit 回调：

```typescript
onSubmit={(text, priority, timeoutMinutes) => {
  handleAddTask(text, priority, timeoutMinutes);
  setShowAddModal(false);
}}
```

同时传入 `call` prop：

```tsx
<AddTaskModal
  open={showAddModal}
  onClose={() => setShowAddModal(false)}
  onSubmit={(text, priority, timeoutMinutes) => {
    handleAddTask(text, priority, timeoutMinutes);
    setShowAddModal(false);
  }}
  defaultPriority={newTaskPriority}
  call={call}
/>
```

- [ ] **Step 5: 提交**

```bash
git add src-ui/src/components/evolution/AddTaskModal.tsx src-ui/src/components/evolution/AddTaskModal.test.tsx src-ui/src/components/evolution/EvolutionDashboard.tsx
git commit -m "feat(ui): refactor AddTaskModal to use TaskCreateForm with priority/timeout/templates"
```

---

## Task 6: 前端 — 改造 QuickCreate 集成优先级/超时/模板

**Files:**
- Modify: `src-ui/src/components/wizard/QuickCreate.tsx`

- [ ] **Step 1: 在 QuickCreate 中添加优先级和超时选择**

在 QuickCreate 组件中：
1. 添加 state：`const [priority, setPriority] = useState(1);` 和 `const [timeoutMinutes, setTimeoutMinutes] = useState(60);`
2. 添加模板加载：`const [templates, setTemplates] = useState([]);` + useEffect 加载 `template.list`
3. 在任务描述 textarea 下方添加模板选择器（标签形式，同 TaskCreateForm 内的模板按钮）
4. 添加优先级和超时的 select（同 TaskCreateForm 样式）
5. 修改 `handleCreate` 和 `handleCreateAndStart` 中的 `tasks` 参数：

```typescript
// 原来：
tasks: [{ content, type: "user_defined" as const, priority: 1, timeoutMinutes: 60 }]
// 改为：
tasks: [{ content, type: "user_defined" as const, priority, timeoutMinutes }]
```

- [ ] **Step 2: 验证编译**

Run: `cd src-ui && npx tsc --noEmit 2>&1 | head -5`
Expected: 无错误

- [ ] **Step 3: 运行 QuickCreate 测试**

Run: `cd src-ui && npx vitest run src/components/wizard/QuickCreate.test.tsx`
Expected: 所有测试通过

- [ ] **Step 4: 提交**

```bash
git add src-ui/src/components/wizard/QuickCreate.tsx
git commit -m "feat(ui): QuickCreate — add priority, timeout, and template selection"
```

---

## Task 7: 前端 — 改造 ShareDashboard 使用 TaskCreateForm

**Files:**
- Modify: `src-ui/src/components/share/ShareDashboard.tsx`
- Modify: `src-ui/src/components/share/ShareDashboard.test.tsx`

- [ ] **Step 1: 替换 ShareDashboard 内联添加任务为 TaskCreateForm**

在 ShareDashboard 中：
1. 导入 TaskCreateForm：`import { TaskCreateForm } from "../common/TaskCreateForm";`
2. 删除 `newTaskText` state 和 `handleAddTask` 函数
3. 添加 `priority` 和 `timeoutMinutes` state
4. 将"新增任务"模态框中的内联 textarea + 按钮替换为：

```tsx
{canEdit && showAddModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center" ...>
    <div className="p-6 w-full max-w-md" ...>
      <h3 className="text-sm font-bold mb-3">新增任务</h3>
      <TaskCreateForm
        onSubmit={async ({ content, priority, timeoutMinutes }) => {
          try {
            await call("task.create", { content, type: "user_defined", priority, timeoutMinutes });
            setShowAddModal(false);
            refresh();
          } catch (err) {
            toast.error(`添加失败: ${err instanceof Error ? err.message : "未知错误"}`);
          }
        }}
        onCancel={() => setShowAddModal(false)}
      />
    </div>
  </div>
)}
```

- [ ] **Step 2: 运行测试**

Run: `cd src-ui && npx vitest run src/components/share/ShareDashboard.test.tsx`
Expected: 所有测试通过（可能需要更新 mock 中 `call("task.create")` 的参数断言）

- [ ] **Step 3: 提交**

```bash
git add src-ui/src/components/share/ShareDashboard.tsx src-ui/src/components/share/ShareDashboard.test.tsx
git commit -m "feat(ui): ShareDashboard — use TaskCreateForm for task creation"
```

---

## Task 8: 前端 — EvolutionDashboard 任务编辑弹窗

**Files:**
- Modify: `src-ui/src/components/evolution/EvolutionDashboard.tsx`

- [ ] **Step 1: 添加任务编辑 state**

在 EvolutionDashboard 的 state 声明区添加：

```typescript
const [editTarget, setEditTarget] = useState<TaskDefinition | null>(null);
```

- [ ] **Step 2: 在任务队列项中添加编辑按钮**

在排队任务的 JSX 中（`queue.map` 内），在"移除"按钮旁添加编辑按钮：

```tsx
<button
  onClick={(e) => { e.stopPropagation(); setEditTarget(task); }}
  className="shrink-0 opacity-0 group-hover:opacity-100 duration-200 hover:opacity-100 text-[11px] px-1.5 py-0.5 rounded font-medium"
  style={{ color: "var(--blue)", border: "1px solid transparent" }}
  aria-label="编辑任务"
  title="编辑任务"
>编辑</button>
```

- [ ] **Step 3: 添加编辑弹窗**

在 ConfirmDialog 之后，SharePanel 之前，添加编辑弹窗：

```tsx
{editTarget && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center"
    style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    onClick={() => setEditTarget(null)}
  >
    <div
      className="p-6 w-full max-w-md"
      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "12px", animation: "slideUp 0.2s ease-out" }}
      onClick={(e) => e.stopPropagation()}
    >
      <h3 className="text-sm font-bold mb-3">编辑任务</h3>
      <TaskCreateForm
        initialContent={editTarget.content}
        defaultPriority={editTarget.priority}
        defaultTimeout={editTarget.timeoutMinutes}
        submitLabel="保存"
        onCancel={() => setEditTarget(null)}
        onSubmit={async ({ content, priority, timeoutMinutes }) => {
          try {
            await call("task.update", { runId: editTarget.runId, taskId: editTarget.id, content, priority, timeoutMinutes });
            const qRes = await call("queue.list", { runId: editTarget.runId });
            setQueue((qRes as { queue: TaskDefinition[] })?.queue || []);
            toast.success("任务已更新");
            setEditTarget(null);
          } catch (err) {
            toast.error(`更新失败: ${err instanceof Error ? err.message : err}`);
          }
        }}
      />
    </div>
  </div>
)}
```

- [ ] **Step 4: 导入 TaskCreateForm**

在 EvolutionDashboard.tsx 顶部添加：

```typescript
import { TaskCreateForm } from "../common/TaskCreateForm";
```

- [ ] **Step 5: 验证编译并运行测试**

Run: `cd src-ui && npx vitest run src/components/evolution/EvolutionDashboard.test.tsx`
Expected: 所有测试通过

- [ ] **Step 6: 提交**

```bash
git add src-ui/src/components/evolution/EvolutionDashboard.tsx
git commit -m "feat(ui): EvolutionDashboard — add task editing for queued tasks"
```

---

## Task 9: 前端 — SettingsPage 模板管理标签页

**Files:**
- Modify: `src-ui/src/components/settings/SettingsPage.tsx`

- [ ] **Step 1: 在 SettingsPage 中添加模板管理区**

在 SettingsPage 中 ProfileManager 区块之后添加模板管理区块：

1. 添加 state：

```typescript
const [templates, setTemplates] = useState<Array<{ id: string; name: string; content: string; priority: number; timeoutMinutes: number; isBuiltIn: boolean; createdAt: number }>>([]);
const [newTplName, setNewTplName] = useState("");
const [newTplContent, setNewTplContent] = useState("");
const [editingTpl, setEditingTpl] = useState<string | null>(null);
```

2. 添加 loadTemplates 函数：

```typescript
const loadTemplates = async () => {
  try {
    const list = await call("template.list", {}) as typeof templates;
    setTemplates(list);
  } catch { /* ignore */ }
};
```

3. 添加 useEffect：`useEffect(() => { loadTemplates(); }, []);`

4. 渲染模板管理区块（在 ProfileManager 之后）：

```tsx
{/* Task Templates */}
<div className="pt-6 border-t" style={{ borderColor: "var(--border)" }}>
  <h3 className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)" }}>任务模板</h3>

  {/* Template list */}
  <div className="space-y-2 mb-4">
    {templates.map((tpl) => (
      <div key={tpl.id} className="px-3 py-2 rounded-lg text-xs flex items-center justify-between" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>{tpl.name}</span>
            {tpl.isBuiltIn && <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "rgba(125,133,144,0.15)", color: "var(--text-secondary)" }}>内置</span>}
          </div>
          <p className="truncate mt-0.5" style={{ color: "var(--text-secondary)" }}>{tpl.content}</p>
        </div>
        {!tpl.isBuiltIn && (
          <div className="flex gap-1 shrink-0 ml-2">
            <button onClick={() => setEditingTpl(editingTpl === tpl.id ? null : tpl.id)} className="px-2 py-1 rounded text-[10px]" style={{ background: "var(--blue)", color: "#fff" }}>编辑</button>
            <button onClick={async () => { await call("template.delete", { id: tpl.id }); loadTemplates(); }} className="px-2 py-1 rounded text-[10px]" style={{ background: "var(--red)", color: "#fff" }}>删除</button>
          </div>
        )}
      </div>
    ))}
    {templates.length === 0 && <p className="text-xs text-center py-4" style={{ color: "var(--text-secondary)" }}>暂无模板</p>}
  </div>

  {/* Create new template */}
  <div className="space-y-2 p-3 rounded-lg" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
    <h4 className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>创建模板</h4>
    <input value={newTplName} onChange={(e) => setNewTplName(e.target.value)} placeholder="模板名称" className="w-full px-3 py-2 rounded text-xs outline-none" style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
    <textarea value={newTplContent} onChange={(e) => setNewTplContent(e.target.value)} placeholder="任务描述模板..." rows={3} className="w-full px-3 py-2 rounded text-xs outline-none resize-none" style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
    <button
      onClick={async () => {
        if (!newTplName.trim() || !newTplContent.trim()) return;
        await call("template.create", { name: newTplName.trim(), content: newTplContent.trim() });
        setNewTplName("");
        setNewTplContent("");
        loadTemplates();
      }}
      disabled={!newTplName.trim() || !newTplContent.trim()}
      className="w-full px-3 py-2 rounded text-xs font-semibold disabled:opacity-40"
      style={{ background: "var(--green)", color: "#fff" }}
    >创建</button>
  </div>
</div>
```

- [ ] **Step 2: 运行设置页测试**

Run: `cd src-ui && npx vitest run src/components/settings/SettingsPage.test.tsx`
Expected: 所有测试通过

- [ ] **Step 3: 提交**

```bash
git add src-ui/src/components/settings/SettingsPage.tsx
git commit -m "feat(ui): SettingsPage — add task template management section"
```

---

## Task 10: 全量测试验证

- [ ] **Step 1: 运行前端全量测试**

Run: `cd src-ui && npx vitest run`
Expected: 所有测试通过

- [ ] **Step 2: 运行引擎全量测试**

Run: `cd src-engine && npx vitest run`
Expected: 所有测试通过（可能存在已有的 long-running flaky test 超时，非本次改动）

- [ ] **Step 3: 最终提交**

如有修复则提交：
```bash
git add -A && git commit -m "fix: resolve test issues from custom task polish"
```
