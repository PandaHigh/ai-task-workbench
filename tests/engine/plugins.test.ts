import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { PluginRegistry, type McpServerConfig } from "../../src-engine/src/plugins/plugin-registry.js";

describe("PluginRegistry", () => {
  let testDir: string;
  let registry: PluginRegistry;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `plugin-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testDir, { recursive: true });
    registry = new PluginRegistry(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  const sampleConfig: McpServerConfig = {
    name: "filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  };

  it("should start with empty list", () => {
    expect(registry.list()).toEqual([]);
  });

  it("should register a new plugin", () => {
    const entry = registry.register(sampleConfig);
    expect(entry.id).toBeTruthy();
    expect(entry.name).toBe("filesystem");
    expect(entry.type).toBe("mcp-server");
    expect(entry.config).toEqual(sampleConfig);
    expect(entry.enabled).toBe(false);
    expect(entry.status).toBe("stopped");
  });

  it("should persist registered plugins", () => {
    registry.register(sampleConfig);
    const registry2 = new PluginRegistry(testDir);
    expect(registry2.list()).toHaveLength(1);
    expect(registry2.list()[0].name).toBe("filesystem");
  });

  it("should list all plugins", () => {
    registry.register(sampleConfig);
    registry.register({ name: "github", command: "npx", args: ["@mcp/github"] });
    expect(registry.list()).toHaveLength(2);
  });

  it("should get a plugin by id", () => {
    const entry = registry.register(sampleConfig);
    const found = registry.get(entry.id);
    expect(found).toBeDefined();
    expect(found?.name).toBe("filesystem");
  });

  it("should return undefined for unknown id", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("should enable a plugin", () => {
    const entry = registry.register(sampleConfig);
    registry.setEnabled(entry.id, true);
    const updated = registry.get(entry.id);
    expect(updated?.enabled).toBe(true);
  });

  it("should disable a plugin", () => {
    const entry = registry.register(sampleConfig);
    registry.setEnabled(entry.id, true);
    registry.setEnabled(entry.id, false);
    expect(registry.get(entry.id)?.enabled).toBe(false);
  });

  it("should update status to running", () => {
    const entry = registry.register(sampleConfig);
    registry.setStatus(entry.id, "running");
    const updated = registry.get(entry.id);
    expect(updated?.status).toBe("running");
    expect(updated?.startedAt).toBeGreaterThan(0);
  });

  it("should update status to error with message", () => {
    const entry = registry.register(sampleConfig);
    registry.setStatus(entry.id, "error", "Process crashed");
    const updated = registry.get(entry.id);
    expect(updated?.status).toBe("error");
    expect(updated?.error).toBe("Process crashed");
  });

  it("should clear startedAt when status is not running", () => {
    const entry = registry.register(sampleConfig);
    registry.setStatus(entry.id, "running");
    registry.setStatus(entry.id, "stopped");
    expect(registry.get(entry.id)?.startedAt).toBeUndefined();
  });

  it("should unregister a plugin", () => {
    const entry = registry.register(sampleConfig);
    const removed = registry.unregister(entry.id);
    expect(removed).toBe(true);
    expect(registry.list()).toHaveLength(0);
  });

  it("should return false for unregistering unknown id", () => {
    expect(registry.unregister("nonexistent")).toBe(false);
  });

  it("should persist changes after unregister", () => {
    const entry = registry.register(sampleConfig);
    registry.unregister(entry.id);
    const registry2 = new PluginRegistry(testDir);
    expect(registry2.list()).toHaveLength(0);
  });

  it("should handle multiple register/unregister cycles", () => {
    const e1 = registry.register(sampleConfig);
    const e2 = registry.register({ name: "github", command: "npx", args: ["@mcp/github"] });
    expect(registry.list()).toHaveLength(2);
    registry.unregister(e1.id);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].name).toBe("github");
  });
});

describe("McpManager", () => {
  it("should import without error", async () => {
    const { McpManager } = await import("../../src-engine/src/plugins/mcp-manager.js");
    const manager = new McpManager();
    expect(manager).toBeDefined();
    expect(manager.isRunning("anything")).toBe(false);
    expect(manager.getRunningServers()).toEqual([]);
  });

  it("stopAll should resolve when no servers running", async () => {
    const { McpManager } = await import("../../src-engine/src/plugins/mcp-manager.js");
    const manager = new McpManager();
    await expect(manager.stopAll()).resolves.toBeUndefined();
  });
});
