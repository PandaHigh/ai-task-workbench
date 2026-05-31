import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetDataDir = vi.fn();
const mockReadJsonFile = vi.fn();
const mockWriteJsonFile = vi.fn();
const mockMkdirSync = vi.fn();
const mockExistsSync = vi.fn();
const mockRmSync = vi.fn();

vi.mock("fs", () => ({
  default: {
    mkdirSync: mockMkdirSync,
    existsSync: mockExistsSync,
    rmSync: mockRmSync,
  },
}));

vi.mock("../../src-engine/src/db/store-utils.js", () => ({
  getDataDir: mockGetDataDir,
  ensureDir: vi.fn(),
  readJsonFile: mockReadJsonFile,
  writeJsonFile: mockWriteJsonFile,
}));

// ── Import after mocks (dynamic to allow vi.mock to take effect) ──────────

const { SkillStore } = await import(
  "../../src-engine/src/db/skill-store.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

import type { SkillMeta } from "../../src-engine/src/db/skill-store.js";

const builtinSkill: SkillMeta = {
  name: "code-review",
  description: "Review code",
  type: "builtin",
  dirName: "code-review",
  createdAt: "2025-01-01T00:00:00.000Z",
  fileCount: 3,
};

const customSkill: SkillMeta = {
  name: "my-custom-skill",
  description: "Custom skill",
  type: "custom",
  dirName: "my-custom-skill",
  createdAt: "2025-06-01T00:00:00.000Z",
  fileCount: 1,
};

describe("SkillStore", () => {
  let store: InstanceType<typeof SkillStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDataDir.mockReturnValue("/data");
    mockReadJsonFile.mockReturnValue([]);
    mockMkdirSync.mockReturnValue(undefined);
    store = new SkillStore();
  });

  // ── constructor ──────────────────────────────────────────────────────

  it("constructor creates custom skills dir", () => {
    expect(mockMkdirSync).toHaveBeenCalledWith("/data/skills/custom", {
      recursive: true,
    });
  });

  // ── list ─────────────────────────────────────────────────────────────

  it("list returns all skills", () => {
    mockReadJsonFile.mockReturnValue([builtinSkill, customSkill]);
    const result = store.list();
    expect(result).toHaveLength(2);
    expect(result).toEqual([builtinSkill, customSkill]);
  });

  it("list with filter returns filtered skills", () => {
    mockReadJsonFile.mockReturnValue([builtinSkill, customSkill]);
    const builtinOnly = store.list({ type: "builtin" });
    expect(builtinOnly).toHaveLength(1);
    expect(builtinOnly[0].type).toBe("builtin");

    const customOnly = store.list({ type: "custom" });
    expect(customOnly).toHaveLength(1);
    expect(customOnly[0].type).toBe("custom");
  });

  // ── findByName ───────────────────────────────────────────────────────

  it("findByName returns matching skill", () => {
    mockReadJsonFile.mockReturnValue([builtinSkill, customSkill]);
    const found = store.findByName("code-review");
    expect(found).toBeDefined();
    expect(found!.name).toBe("code-review");
  });

  it("findByName returns undefined for no match", () => {
    mockReadJsonFile.mockReturnValue([builtinSkill]);
    const found = store.findByName("nonexistent");
    expect(found).toBeUndefined();
  });

  // ── add ──────────────────────────────────────────────────────────────

  it("add appends new skill", () => {
    mockReadJsonFile.mockReturnValue([builtinSkill]);
    store.add(customSkill);
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      "/data/skills.json",
      [builtinSkill, customSkill]
    );
  });

  it("add upserts existing skill by name", () => {
    const updatedSkill: SkillMeta = {
      ...customSkill,
      description: "Updated description",
    };
    mockReadJsonFile.mockReturnValue([builtinSkill, customSkill]);
    store.add(updatedSkill);
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      "/data/skills.json",
      [builtinSkill, updatedSkill]
    );
  });

  // ── remove ───────────────────────────────────────────────────────────

  it("remove returns false for builtin skills", () => {
    mockReadJsonFile.mockReturnValue([builtinSkill]);
    const result = store.remove("code-review");
    expect(result).toBe(false);
    expect(mockWriteJsonFile).not.toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it("remove returns false for nonexistent skill", () => {
    mockReadJsonFile.mockReturnValue([builtinSkill]);
    const result = store.remove("nonexistent");
    expect(result).toBe(false);
    expect(mockWriteJsonFile).not.toHaveBeenCalled();
  });

  it("remove deletes custom skill and its directory", () => {
    mockReadJsonFile.mockReturnValue([builtinSkill, customSkill]);
    mockExistsSync.mockReturnValue(true);
    const result = store.remove("my-custom-skill");
    expect(result).toBe(true);
    expect(mockExistsSync).toHaveBeenCalledWith(
      "/data/skills/custom/my-custom-skill"
    );
    expect(mockRmSync).toHaveBeenCalledWith(
      "/data/skills/custom/my-custom-skill",
      { recursive: true }
    );
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      "/data/skills.json",
      [builtinSkill]
    );
  });

  // ── getCustomSkillsDir ───────────────────────────────────────────────

  it("getCustomSkillsDir returns path", () => {
    expect(store.getCustomSkillsDir()).toBe("/data/skills/custom");
  });
});
