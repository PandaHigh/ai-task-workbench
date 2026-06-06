/**
 * Workflow Store — 持久化层
 *
 * 存储 workflow 定义库和执行状态。
 * 遵循项目现有的 JSON 文件原子写入模式。
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { WorkflowDefinition, WorkflowExecution } from "./workflow-types.js";

function dataDir(): string {
  const platform = process.platform;
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "ai-task-workbench");
  if (platform === "win32")
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "ai-task-workbench");
  return join(homedir(), ".local", "share", "ai-task-workbench");
}

export class WorkflowStore {
  private dir: string;
  private definitions = new Map<string, WorkflowDefinition>();
  private executions = new Map<string, WorkflowExecution>();
  private loaded = false;

  constructor(baseDir?: string) {
    this.dir = join(baseDir ?? dataDir(), "workflows");
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    await this.ensureDir();

    try {
      const defPath = join(this.dir, "definitions.json");
      const raw = await fs.readFile(defPath, "utf-8");
      const defs: WorkflowDefinition[] = JSON.parse(raw);
      for (const d of defs) this.definitions.set(d.id, d);
    } catch {
      // 文件不存在或解析失败，从空开始
    }

    this.loaded = true;
  }

  private async saveDefinitions(): Promise<void> {
    await this.ensureDir();
    const tmpPath = join(this.dir, "definitions.json.tmp");
    const finalPath = join(this.dir, "definitions.json");
    const data = JSON.stringify([...this.definitions.values()], null, 2);
    await fs.writeFile(tmpPath, data, "utf-8");
    await fs.rename(tmpPath, finalPath);
  }

  // ─── Definition CRUD ────────────────────────────────────────────────

  /** 注册一个 workflow 定义（内置模板在启动时注册） */
  async register(definition: WorkflowDefinition): Promise<void> {
    await this.load();
    this.definitions.set(definition.id, definition);
    if (!definition.isBuiltIn) {
      await this.saveDefinitions();
    }
  }

  /** 批量注册内置模板 */
  async registerBuiltins(definitions: WorkflowDefinition[]): Promise<void> {
    await this.load();
    for (const d of definitions) {
      // 内置模板每次都重新注册（可能更新）
      this.definitions.set(d.id, d);
    }
  }

  list(): WorkflowDefinition[] {
    return [...this.definitions.values()];
  }

  get(id: string): WorkflowDefinition | undefined {
    return this.definitions.get(id);
  }

  async delete(id: string): Promise<boolean> {
    const def = this.definitions.get(id);
    if (!def || def.isBuiltIn) return false;
    this.definitions.delete(id);
    await this.saveDefinitions();
    return true;
  }

  // ─── Execution state ────────────────────────────────────────────────

  saveExecution(execution: WorkflowExecution): void {
    this.executions.set(execution.id, execution);
  }

  getExecution(id: string): WorkflowExecution | undefined {
    return this.executions.get(id);
  }

  listExecutions(runId?: string): WorkflowExecution[] {
    const all = [...this.executions.values()];
    if (runId) return all.filter((e) => e.runId === runId);
    return all;
  }
}
