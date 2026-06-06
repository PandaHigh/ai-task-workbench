import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockEnsureDir = vi.fn();
const mockReadJsonFile = vi.fn();
const mockWriteJsonFile = vi.fn();
const mockRandomUUID = vi.fn();

vi.stubGlobal("crypto", { randomUUID: mockRandomUUID });

vi.mock("../../src-engine/src/db/store-utils.js", () => ({
  ensureDir: mockEnsureDir,
  readJsonFile: mockReadJsonFile,
  writeJsonFile: mockWriteJsonFile,
}));

// ── Import after mocks ─────────────────────────────────────────────────────

const { PluginRegistry } = await import("../../src-engine/src/plugins/plugin-registry.js");

// ── Helpers ────────────────────────────────────────────────────────────────

import type { McpServerConfig } from "../../src-engine/src/plugins/plugin-registry.js";

const sampleConfig: McpServerConfig = {
  name: "filesystem",
  command: "npx",
  args: ["-y", "@mcp/server-filesystem"],
};

describe("PluginRegistry", () => {
  let registry: InstanceType<typeof PluginRegistry>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureDir.mockReturnValue(undefined);
    mockReadJsonFile.mockReturnValue([]);
    mockWriteJsonFile.mockReturnValue(undefined);
    mockRandomUUID.mockReturnValue("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

    registry = new PluginRegistry("/data");
  });

  // ── register ─────────────────────────────────────────────────────────

  it("register creates entry with mcp- prefix id, enabled=false, status=stopped", () => {
    const entry = registry.register(sampleConfig);

    expect(entry.id).toBe("mcp-aaaaaaaa");
    expect(entry.name).toBe("filesystem");
    expect(entry.description).toBe("");
    expect(entry.type).toBe("mcp-server");
    expect(entry.config).toEqual(sampleConfig);
    expect(entry.enabled).toBe(false);
    expect(entry.status).toBe("stopped");
    expect(entry.startedAt).toBeUndefined();
    expect(entry.error).toBeUndefined();

    expect(mockWriteJsonFile).toHaveBeenCalledWith("/data/plugins.json", [entry]);
  });

  // ── list ─────────────────────────────────────────────────────────────

  it("list returns all entries", () => {
    registry.register(sampleConfig);
    mockRandomUUID.mockReturnValue("bbbbbbbb-cccc-dddd-eeee-ffffffffffff");
    registry.register({ name: "github", command: "npx", args: ["@mcp/github"] });

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("filesystem");
    expect(list[1].name).toBe("github");
  });

  // ── get ──────────────────────────────────────────────────────────────

  it("get returns entry by id", () => {
    const entry = registry.register(sampleConfig);
    const found = registry.get(entry.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("filesystem");
  });

  it("get returns undefined for nonexistent", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  // ── unregister ───────────────────────────────────────────────────────

  it("unregister removes and returns true", () => {
    const entry = registry.register(sampleConfig);
    const result = registry.unregister(entry.id);
    expect(result).toBe(true);
    expect(registry.get(entry.id)).toBeUndefined();
    expect(mockWriteJsonFile).toHaveBeenCalledTimes(2); // register + unregister
  });

  it("unregister returns false for nonexistent", () => {
    const result = registry.unregister("nonexistent");
    expect(result).toBe(false);
    // Only called during register if any, none here since list was empty
  });

  // ── setEnabled ───────────────────────────────────────────────────────

  it("setEnabled toggles enabled flag", () => {
    const entry = registry.register(sampleConfig);
    registry.setEnabled(entry.id, true);
    expect(registry.get(entry.id)!.enabled).toBe(true);

    registry.setEnabled(entry.id, false);
    expect(registry.get(entry.id)!.enabled).toBe(false);
  });

  it("setEnabled is no-op for nonexistent", () => {
    registry.setEnabled("nonexistent", true);
    expect(mockWriteJsonFile).not.toHaveBeenCalled();
  });

  // ── setStatus ────────────────────────────────────────────────────────

  it("setStatus updates status and error", () => {
    const entry = registry.register(sampleConfig);
    registry.setStatus(entry.id, "error", "Something went wrong");

    const updated = registry.get(entry.id)!;
    expect(updated.status).toBe("error");
    expect(updated.error).toBe("Something went wrong");
  });

  it("setStatus sets startedAt when running", () => {
    const entry = registry.register(sampleConfig);
    const before = Date.now();
    registry.setStatus(entry.id, "running");
    const after = Date.now();

    const updated = registry.get(entry.id)!;
    expect(updated.status).toBe("running");
    expect(updated.startedAt).toBeGreaterThanOrEqual(before);
    expect(updated.startedAt).toBeLessThanOrEqual(after);
  });

  it("setStatus clears startedAt when not running", () => {
    const entry = registry.register(sampleConfig);
    registry.setStatus(entry.id, "running");
    expect(registry.get(entry.id)!.startedAt).toBeDefined();

    registry.setStatus(entry.id, "stopped");
    expect(registry.get(entry.id)!.startedAt).toBeUndefined();
  });
});
