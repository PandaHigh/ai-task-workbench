import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import type { ExecutionRun } from "../../shared/src/task-types";

describe("Share Integration", () => {
  let methodHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>>;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `ai-workbench-share-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

    const mod = await import("../../src-engine/src/json-rpc/methods.js");
    methodHandlers = mod.methodHandlers;
    mod.setNotifyFn(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createRun(): Promise<ExecutionRun> {
    return methodHandlers["run.create"]({
      workingDir: "/tmp/test-share",
      goals: ["goal 1"],
      terminationConditions: ["done when goal met"],
    }) as Promise<ExecutionRun>;
  }

  // ─── share.create / share.list / share.revoke ────────────────────────────

  describe("share.create", () => {
    it("should create a share token for an existing run", async () => {
      const run = await createRun();
      const result = await methodHandlers["share.create"]({ runId: run.id }) as Record<string, unknown>;
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe("string");
      expect(result.url).toContain("/#/share/");
      expect(result.apiUrl).toContain("/api/share/");
      expect(result.createdAt).toBeTypeOf("number");
    });

    it("should reject non-existent run", async () => {
      await expect(
        methodHandlers["share.create"]({ runId: "nonexistent" }),
      ).rejects.toThrow("Run not found");
    });

    it("should create share with label", async () => {
      const run = await createRun();
      const result = await methodHandlers["share.create"]({ runId: run.id, label: "Team review" }) as Record<string, unknown>;
      expect(result.token).toBeDefined();
    });
  });

  describe("share.list", () => {
    it("should list all shares", async () => {
      const run = await createRun();
      await methodHandlers["share.create"]({ runId: run.id });
      const shares = await methodHandlers["share.list"]({}) as Array<Record<string, unknown>>;
      expect(shares.length).toBeGreaterThanOrEqual(1);
      expect(shares.some(s => s.runId === run.id)).toBe(true);
    });

    it("should filter shares by runId", async () => {
      const run1 = await createRun();
      const run2 = await createRun();
      await methodHandlers["share.create"]({ runId: run1.id });
      await methodHandlers["share.create"]({ runId: run2.id });

      const shares = await methodHandlers["share.list"]({ runId: run1.id }) as Array<Record<string, unknown>>;
      expect(shares).toHaveLength(1);
      expect(shares[0].runId).toBe(run1.id);
    });
  });

  describe("share.revoke", () => {
    it("should revoke a share token", async () => {
      const run = await createRun();
      const share = await methodHandlers["share.create"]({ runId: run.id }) as Record<string, unknown>;

      const result = await methodHandlers["share.revoke"]({ token: share.token });
      expect(result).toEqual({ revoked: true });

      // Verify revoked
      const shares = await methodHandlers["share.list"]({ runId: run.id }) as Array<unknown>;
      expect(shares).toHaveLength(0);
    });

    it("should reject unknown token", async () => {
      await expect(
        methodHandlers["share.revoke"]({ token: "nonexistent" }),
      ).rejects.toThrow("Token not found");
    });
  });

  // ─── share.subscribe / share.unsubscribe / share.subscriptions ────────────

  describe("share.subscribe", () => {
    it("should reject invalid URL format", async () => {
      await expect(
        methodHandlers["share.subscribe"]({ url: "not-a-url" }),
      ).rejects.toThrow("Invalid share URL format");
    });

    it("should reject unreachable remote engine", async () => {
      await expect(
        methodHandlers["share.subscribe"]({ url: "http://localhost:19999/api/share/abc-123" }),
      ).rejects.toThrow();
    });
  });

  describe("share.unsubscribe", () => {
    it("should reject unknown runId", async () => {
      await expect(
        methodHandlers["share.unsubscribe"]({ runId: "nonexistent" }),
      ).rejects.toThrow("Subscription not found");
    });
  });

  describe("share.subscriptions", () => {
    it("should list empty subscriptions initially", async () => {
      const subs = await methodHandlers["share.subscriptions"]({});
      expect(subs).toEqual([]);
    });
  });

  // ─── Remote run proxy in run.list ───────────────────────────────────────

  describe("run.list with remote subscriptions", () => {
    it("should return local runs even without remote subscriptions", async () => {
      await createRun();
      const runs = await methodHandlers["run.list"]({}) as ExecutionRun[];
      expect(runs.length).toBeGreaterThanOrEqual(1);
      expect(runs[0].source).toBeUndefined();
    });
  });

  // ─── Task operations on remote runs ─────────────────────────────────────

  describe("task operations on remote runs", () => {
    it("should reject remote run task.create when engine unreachable", async () => {
      const mod = await import("../../src-engine/src/db/subscription-store.js");
      const subStore = new mod.SubscriptionStore(testDir);
      subStore.subscribe({
        runId: "remote-test-123",
        remoteUrl: "http://localhost:19999",
        remoteToken: "fake-token",
        remoteRunId: "original-run-id",
        label: "Test remote",
      });

      await expect(
        methodHandlers["task.create"]({ runId: "remote-test-123", content: "test task" }),
      ).rejects.toThrow();
    });

    it("should reject remote run.run.tasks when engine unreachable", async () => {
      const mod = await import("../../src-engine/src/db/subscription-store.js");
      const subStore = new mod.SubscriptionStore(testDir);
      subStore.subscribe({
        runId: "remote-tasks-456",
        remoteUrl: "http://localhost:19999",
        remoteToken: "fake-token",
        remoteRunId: "original-run-id",
        label: "Test remote",
      });

      await expect(
        methodHandlers["run.tasks"]({ runId: "remote-tasks-456" }),
      ).rejects.toThrow();
    });

    it("should reject remote run.run.stop when engine unreachable", async () => {
      const mod = await import("../../src-engine/src/db/subscription-store.js");
      const subStore = new mod.SubscriptionStore(testDir);
      subStore.subscribe({
        runId: "remote-stop-789",
        remoteUrl: "http://localhost:19999",
        remoteToken: "fake-token",
        remoteRunId: "original-run-id",
        label: "Test remote",
      });

      await expect(
        methodHandlers["run.stop"]({ runId: "remote-stop-789" }),
      ).rejects.toThrow();
    });
  });
});
