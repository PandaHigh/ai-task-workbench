import path from "path";
import { randomUUID } from "crypto";
import { getDataDir, ensureDir, readJsonFile, writeJsonFile } from "./store-utils.js";
import type { UserTaskTemplate } from "@ai-workbench/shared";

export type { UserTaskTemplate } from "@ai-workbench/shared";

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
