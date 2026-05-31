import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetDataDir = vi.fn();
const mockEnsureDir = vi.fn();
const mockReadJsonFile = vi.fn();
const mockWriteJsonFile = vi.fn();
const mockRandomUUID = vi.fn();

vi.mock("crypto", () => ({
  randomUUID: mockRandomUUID,
}));

vi.mock("../../src-engine/src/db/store-utils.js", () => ({
  getDataDir: mockGetDataDir,
  ensureDir: mockEnsureDir,
  readJsonFile: mockReadJsonFile,
  writeJsonFile: mockWriteJsonFile,
}));

// ── Import after mocks ─────────────────────────────────────────────────────

const { TemplateStore } = await import(
  "../../src-engine/src/db/template-store.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

import type { UserTaskTemplate } from "@ai-workbench/shared";

const builtinTemplate: UserTaskTemplate = {
  id: "builtin-1",
  name: "Built-in Template",
  content: "Do something",
  priority: 5,
  timeoutMinutes: 60,
  isBuiltIn: true,
  createdAt: 1000,
  updatedAt: 1000,
};

const userTemplate: UserTaskTemplate = {
  id: "user-1",
  name: "My Template",
  content: "User content",
  priority: 3,
  timeoutMinutes: 30,
  isBuiltIn: false,
  createdAt: 2000,
  updatedAt: 2000,
};

describe("TemplateStore", () => {
  let store: InstanceType<typeof TemplateStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDataDir.mockReturnValue("/data");
    mockReadJsonFile.mockReturnValue([]);
    mockRandomUUID.mockReturnValue("test-uuid-1234");
    store = new TemplateStore();
  });

  // ── create ───────────────────────────────────────────────────────────

  it("create generates UUID, sets defaults, persists", () => {
    mockReadJsonFile.mockReturnValue([]);
    const result = store.create({
      name: "New Template",
      content: "Hello world",
    });

    expect(result.id).toBe("test-uuid-1234");
    expect(result.name).toBe("New Template");
    expect(result.content).toBe("Hello world");
    expect(result.priority).toBe(5);
    expect(result.timeoutMinutes).toBe(60);
    expect(result.isBuiltIn).toBe(false);
    expect(typeof result.createdAt).toBe("number");
    expect(typeof result.updatedAt).toBe("number");
    expect(result.createdAt).toBe(result.updatedAt);

    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      "/data/templates.json",
      [result]
    );
  });

  it("create uses provided priority and timeoutMinutes", () => {
    mockReadJsonFile.mockReturnValue([]);
    const result = store.create({
      name: "Custom",
      content: "content",
      priority: 10,
      timeoutMinutes: 120,
    });

    expect(result.priority).toBe(10);
    expect(result.timeoutMinutes).toBe(120);
  });

  // ── list ─────────────────────────────────────────────────────────────

  it("list returns all templates", () => {
    mockReadJsonFile.mockReturnValue([builtinTemplate, userTemplate]);
    const result = store.list();
    expect(result).toHaveLength(2);
    expect(result).toEqual([builtinTemplate, userTemplate]);
  });

  // ── update ───────────────────────────────────────────────────────────

  it("update merges updates and sets updatedAt", () => {
    mockReadJsonFile.mockReturnValue([userTemplate]);
    const result = store.update("user-1", { name: "Updated Name" });
    expect(result).toBeDefined();
    expect(result!.name).toBe("Updated Name");
    expect(result!.updatedAt).toBeGreaterThanOrEqual(userTemplate.updatedAt);
    // Other fields preserved
    expect(result!.content).toBe("User content");
    expect(result!.priority).toBe(3);
  });

  it("update throws for built-in templates", () => {
    mockReadJsonFile.mockReturnValue([builtinTemplate]);
    expect(() => store.update("builtin-1", { name: "Hacked" })).toThrow(
      "Cannot modify built-in template"
    );
    expect(mockWriteJsonFile).not.toHaveBeenCalled();
  });

  it("update returns undefined for nonexistent ID", () => {
    mockReadJsonFile.mockReturnValue([userTemplate]);
    const result = store.update("nonexistent", { name: "X" });
    expect(result).toBeUndefined();
    expect(mockWriteJsonFile).not.toHaveBeenCalled();
  });

  // ── delete ───────────────────────────────────────────────────────────

  it("delete returns true on success", () => {
    mockReadJsonFile.mockReturnValue([userTemplate]);
    const result = store.delete("user-1");
    expect(result).toBe(true);
    expect(mockWriteJsonFile).toHaveBeenCalledWith("/data/templates.json", []);
  });

  it("delete throws for built-in templates", () => {
    mockReadJsonFile.mockReturnValue([builtinTemplate]);
    expect(() => store.delete("builtin-1")).toThrow(
      "Cannot delete built-in template"
    );
    expect(mockWriteJsonFile).not.toHaveBeenCalled();
  });

  it("delete returns false for nonexistent ID", () => {
    mockReadJsonFile.mockReturnValue([userTemplate]);
    const result = store.delete("nonexistent");
    expect(result).toBe(false);
    expect(mockWriteJsonFile).not.toHaveBeenCalled();
  });
});
