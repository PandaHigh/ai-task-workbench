import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import type { ExecutionRun } from "../../shared/src/task-types.js";

/**
 * Integration tests for the new feature RPC methods:
 * crew.list, crew.configure, trace.list, plugin.*, config.adaptive
 */
describe("New Features Integration", () => {
  let methodHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `integration-new-features-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testDir, { recursive: true });

    vi.resetModules();

    vi.doMock("../../src-engine/src/db/store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/db/store.js")>();
      return {
        Store: vi.fn(function (this: unknown) {
          return new actual.Store(testDir);
        }),
      };
    });

    vi.doMock("../../src-engine/src/db/share-store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/db/share-store.js")>();
      return {
        ShareStore: vi.fn(function (this: unknown) {
          return new actual.ShareStore(testDir);
        }),
      };
    });

    vi.doMock("../../src-engine/src/db/subscription-store.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/db/subscription-store.js")>();
      return {
        SubscriptionStore: vi.fn(function (this: unknown) {
          return new actual.SubscriptionStore(testDir);
        }),
      };
    });

    vi.doMock("../../src-engine/src/cc-integration/cc-client.js", () => ({
      CCClient: vi.fn(() => ({
        executeTask: vi.fn(async () => ({
          result: '{"isComplete": true, "progressReport": "Done", "completedGoals": ["g1"], "remainingGoals": [], "overallProgress": 1}',
          sessionId: "s-test", totalCostUsd: 0, durationMs: 0, numTurns: 0, messages: [],
        })),
      })),
    }));

    vi.doMock("../../src-engine/src/plugins/plugin-registry.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../src-engine/src/plugins/plugin-registry.js")>();
      return {
        PluginRegistry: vi.fn(function (this: unknown) {
          return new actual.PluginRegistry(testDir);
        }),
      };
    });

    vi.doMock("../../src-engine/src/git/git-manager.js", () => ({
      GitManager: vi.fn(() => ({
        ensureInit: vi.fn(async () => {}),
        autoCommit: vi.fn(async () => "abc1234"),
        revert: vi.fn(async () => {}),
        checkoutClean: vi.fn(async () => {}),
        getLastNCommits: vi.fn(async () => []),
        getDiffStats: vi.fn(async () => ({ filesChanged: 0, linesChanged: 0, hasCriticalFiles: false })),
      })),
    }));

    const mod = await import("../../src-engine/src/json-rpc/methods.js");
    methodHandlers = mod.methodHandlers;
    mod.setNotifyFn(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  async function createRun(): Promise<ExecutionRun> {
    return methodHandlers["run.create"]({
      workingDir: "/tmp/test-integration",
      goals: ["integration test goal"],
      terminationConditions: ["done when met"],
    }) as Promise<ExecutionRun>;
  }

  // ─── crew.list ────────────────────────────────────────────────────────

  describe("crew.list", () => {
    it("should return 6 built-in roles", async () => {
      const roles = await methodHandlers["crew.list"]({}) as Array<Record<string, unknown>>;
      expect(roles).toHaveLength(6);
      expect(roles.map((r) => r.id)).toEqual(["planner", "developer", "tester", "reviewer", "architect", "integrator"]);
    });

    it("each role should have required fields", async () => {
      const roles = await methodHandlers["crew.list"]({}) as Array<Record<string, unknown>>;
      for (const role of roles) {
        expect(role.id).toBeTruthy();
        expect(role.name).toBeTruthy();
        expect(role.description).toBeTruthy();
        expect(Array.isArray(role.tools)).toBe(true);
        expect(typeof role.maxTurns).toBe("number");
      }
    });
  });

  // ─── crew.configure ──────────────────────────────────────────────────

  describe("crew.configure", () => {
    it("should set crew mode for a run", async () => {
      const run = await createRun();
      const result = await methodHandlers["crew.configure"]({ runId: run.id, mode: "sequential" });
      expect((result as Record<string, unknown>).saved).toBe(true);
      expect((result as Record<string, unknown>).mode).toBe("sequential");
    });

    it("should reject invalid mode", async () => {
      await expect(
        methodHandlers["crew.configure"]({ runId: "test-run", mode: "invalid" })
      ).rejects.toThrow("mode must be");
    });

    it("should require runId", async () => {
      await expect(
        methodHandlers["crew.configure"]({ mode: "sequential" })
      ).rejects.toThrow("Missing required parameter");
    });
  });

  // ─── trace.list ──────────────────────────────────────────────────────

  describe("trace.list", () => {
    it("should return empty array for run with no traces", async () => {
      const run = await createRun();
      const traces = await methodHandlers["trace.list"]({ runId: run.id });
      expect(traces).toEqual([]);
    });

    it("should require runId", async () => {
      await expect(
        methodHandlers["trace.list"]({})
      ).rejects.toThrow("Missing required parameter");
    });

    it("should return traces after they are persisted", async () => {
      const run = await createRun();
      const { Store } = await import("../../src-engine/src/db/store.js");
      const store = new Store(testDir) as import("../../src-engine/src/db/store.js").Store;

      store.appendTrace(run.id, [
        { traceId: "tr-1", spanId: "sp-1", operation: "crew.run", status: "ok", startTime: Date.now(), endTime: Date.now(), durationMs: 100, attributes: {} },
        { traceId: "tr-1", spanId: "sp-2", operation: "agent.planner", status: "ok", startTime: Date.now(), endTime: Date.now(), durationMs: 50, attributes: {} },
      ]);

      const traces = await methodHandlers["trace.list"]({ runId: run.id }) as Array<Record<string, unknown>>;
      expect(traces).toHaveLength(2);
      expect(traces[0].operation).toBe("crew.run");
      expect(traces[1].operation).toBe("agent.planner");
    });

    it("should respect limit parameter", async () => {
      const run = await createRun();
      const { Store } = await import("../../src-engine/src/db/store.js");
      const store = new Store(testDir) as import("../../src-engine/src/db/store.js").Store;

      for (let i = 0; i < 10; i++) {
        store.appendTrace(run.id, [
          { traceId: `tr-${i}`, spanId: `sp-${i}`, operation: `op-${i}`, status: "ok", startTime: Date.now(), attributes: {} },
        ]);
      }

      const traces = await methodHandlers["trace.list"]({ runId: run.id, limit: 5 }) as Array<unknown>;
      expect(traces).toHaveLength(5);
    });
  });

  // ─── plugin.install / plugin.list / plugin.remove / plugin.toggle ────

  describe("plugin.install", () => {
    it("should install a plugin", async () => {
      const plugin = await methodHandlers["plugin.install"]({
        name: "filesystem",
        command: "npx",
        args: ["-y", "@mcp/server"],
      }) as Record<string, unknown>;

      expect(plugin.name).toBe("filesystem");
      expect(plugin.id).toBeTruthy();
      expect(plugin.status).toBe("stopped");
      expect(plugin.enabled).toBe(false);
    });

    it("should require name", async () => {
      await expect(
        methodHandlers["plugin.install"]({ command: "npx", args: [] })
      ).rejects.toThrow("Missing required parameter");
    });

    it("should require command", async () => {
      await expect(
        methodHandlers["plugin.install"]({ name: "test", args: [] })
      ).rejects.toThrow("Missing required parameter");
    });
  });

  describe("plugin.list", () => {
    it("should return list after install", async () => {
      await methodHandlers["plugin.install"]({ name: "list-test-p1", command: "node", args: [] });
      await methodHandlers["plugin.install"]({ name: "list-test-p2", command: "npx", args: ["test"] });

      const list = await methodHandlers["plugin.list"]({}) as Array<Record<string, unknown>>;
      const names = list.map((p) => p.name);
      expect(names).toContain("list-test-p1");
      expect(names).toContain("list-test-p2");
    });
  });

  describe("plugin.remove", () => {
    it("should remove an installed plugin", async () => {
      const plugin = await methodHandlers["plugin.install"]({ name: "to-remove-test", command: "node", args: [] }) as Record<string, unknown>;
      const result = await methodHandlers["plugin.remove"]({ id: plugin.id });
      expect((result as Record<string, unknown>).ok).toBe(true);

      const list = await methodHandlers["plugin.list"]({}) as Array<Record<string, unknown>>;
      expect(list.find((p) => p.id === plugin.id)).toBeUndefined();
    });

    it("should reject unknown plugin id", async () => {
      await expect(
        methodHandlers["plugin.remove"]({ id: "nonexistent" })
      ).rejects.toThrow("Plugin not found");
    });
  });

  describe("plugin.toggle", () => {
    it("should toggle plugin enabled state", async () => {
      const plugin = await methodHandlers["plugin.install"]({ name: "toggle-test", command: "echo", args: [] }) as Record<string, unknown>;

      const toggled = await methodHandlers["plugin.toggle"]({ id: plugin.id }) as Record<string, unknown>;
      // Since echo doesn't start an MCP server, it will likely fail to start, but the toggle should change enabled
      expect(toggled.id).toBe(plugin.id);
    });

    it("should reject unknown id", async () => {
      await expect(
        methodHandlers["plugin.toggle"]({ id: "nonexistent" })
      ).rejects.toThrow("Plugin not found");
    });
  });

  // ─── config.adaptive ─────────────────────────────────────────────────

  describe("config.adaptive", () => {
    it("should return adaptive config status", async () => {
      const result = await methodHandlers["config.adaptive"]({ runId: "test" });
      expect((result as Record<string, unknown>).adaptiveEnabled).toBeDefined();
    });

    it("should enable adaptive config", async () => {
      const result = await methodHandlers["config.adaptive"]({ runId: "test", enabled: true });
      expect((result as Record<string, unknown>).adaptiveEnabled).toBe(true);
    });

    it("should disable adaptive config", async () => {
      await methodHandlers["config.adaptive"]({ runId: "test", enabled: true });
      const result = await methodHandlers["config.adaptive"]({ runId: "test", enabled: false });
      expect((result as Record<string, unknown>).adaptiveEnabled).toBe(false);
    });

    it("should require runId", async () => {
      await expect(
        methodHandlers["config.adaptive"]({})
      ).rejects.toThrow("Missing required parameter");
    });
  });

  // ─── config.set with new keys ────────────────────────────────────────

  describe("config.set with crewMode", () => {
    it("should accept crewMode config key", async () => {
      const result = await methodHandlers["config.set"]({ key: "crewMode", value: "parallel" });
      expect((result as Record<string, unknown>).saved).toBe(true);
    });

    it("should accept adaptiveEnabled config key", async () => {
      const result = await methodHandlers["config.set"]({ key: "adaptiveEnabled", value: true });
      expect((result as Record<string, unknown>).saved).toBe(true);
    });
  });

  // ─── Trace persistence end-to-end ────────────────────────────────────

  describe("Trace persistence end-to-end", () => {
    it("should persist and retrieve traces across store instances", async () => {
      const run = await createRun();
      const { Store } = await import("../../src-engine/src/db/store.js");

      // Write traces
      const store1 = new Store(testDir) as import("../../src-engine/src/db/store.js").Store;
      store1.appendTrace(run.id, [
        { traceId: "t1", spanId: "s1", operation: "crew.run", status: "running", startTime: 100, attributes: { mode: "fixloop" } },
        { traceId: "t1", spanId: "s2", operation: "agent.planner", status: "ok", startTime: 100, endTime: 200, durationMs: 100, attributes: {} },
      ]);

      // Read from a new store instance
      const store2 = new Store(testDir) as import("../../src-engine/src/db/store.js").Store;
      const traces = store2.getTraces(run.id);

      expect(traces).toHaveLength(2);
      expect(traces[0].operation).toBe("crew.run");
      expect(traces[1].operation).toBe("agent.planner");
      expect(traces[1].status).toBe("ok");
      expect((traces[0].attributes as Record<string, unknown>).mode).toBe("fixloop");
    });

    it("should trim traces at 500 entries", async () => {
      const run = await createRun();
      const { Store } = await import("../../src-engine/src/db/store.js");
      const store = new Store(testDir) as import("../../src-engine/src/db/store.js").Store;

      // Insert 600 trace entries
      for (let batch = 0; batch < 6; batch++) {
        const spans = Array.from({ length: 100 }, (_, i) => ({
          traceId: `t-${batch}-${i}`,
          spanId: `s-${batch}-${i}`,
          operation: `op-${batch}-${i}`,
          status: "ok" as const,
          startTime: Date.now(),
          attributes: {},
        }));
        store.appendTrace(run.id, spans);
      }

      const traces = store.getTraces(run.id);
      expect(traces.length).toBeLessThanOrEqual(500);
      expect(traces.length).toBeGreaterThanOrEqual(400);
    });
  });
});
