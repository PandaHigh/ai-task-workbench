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

    it("should create share with expiresAt", async () => {
      const run = await createRun();
      const expiresAt = Date.now() + 3600_000;
      const result = await methodHandlers["share.create"]({ runId: run.id, label: "1h link", expiresAt }) as Record<string, unknown>;
      expect(result.token).toBeDefined();

      // Verify expiresAt stored correctly
      const shares = await methodHandlers["share.list"]({ runId: run.id }) as Array<Record<string, unknown>>;
      expect(shares).toHaveLength(1);
      expect(shares[0].expiresAt).toBe(expiresAt);
      expect(shares[0].label).toBe("1h link");
    });

    it("should create share without expiresAt (null by default)", async () => {
      const run = await createRun();
      await methodHandlers["share.create"]({ runId: run.id });

      const shares = await methodHandlers["share.list"]({ runId: run.id }) as Array<Record<string, unknown>>;
      expect(shares).toHaveLength(1);
      expect(shares[0].expiresAt).toBeNull();
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

  describe("ShareStore revokeByRunId", () => {
    it("should remove all shares for a given runId", async () => {
      const run = await createRun();
      await methodHandlers["share.create"]({ runId: run.id, label: "share 1" });
      await methodHandlers["share.create"]({ runId: run.id, label: "share 2" });
      const run2 = await createRun();
      await methodHandlers["share.create"]({ runId: run2.id, label: "other share" });

      const before = await methodHandlers["share.list"]({ runId: run.id }) as unknown[];
      expect(before).toHaveLength(2);

      const result = await methodHandlers["run.delete"]({ runId: run.id }) as Record<string, unknown>;
      expect(result.deleted).toBe(true);

      const after = await methodHandlers["share.list"]({ runId: run.id }) as unknown[];
      expect(after).toHaveLength(0);

      const otherShares = await methodHandlers["share.list"]({ runId: run2.id }) as unknown[];
      expect(otherShares).toHaveLength(1);
    });
  });

  // ─── Token expiration ─────────────────────────────────────────────────────

  describe("Token expiration", () => {
    it("should list expired tokens but mark them", async () => {
      const run = await createRun();
      const pastExpiry = Date.now() - 1000; // expired 1s ago
      await methodHandlers["share.create"]({ runId: run.id, label: "expired", expiresAt: pastExpiry });
      await methodHandlers["share.create"]({ runId: run.id, label: "valid" });

      const shares = await methodHandlers["share.list"]({ runId: run.id }) as Array<Record<string, unknown>>;
      expect(shares).toHaveLength(2);
      const expired = shares.find(s => s.label === "expired")!;
      const valid = shares.find(s => s.label === "valid")!;
      expect(expired.expiresAt).toBeLessThan(Date.now());
      expect(valid.expiresAt).toBeNull();
    });

    it("should revoke expired token on access via getByToken", async () => {
      const run = await createRun();
      const pastExpiry = Date.now() - 1000;
      const share = await methodHandlers["share.create"]({ runId: run.id, label: "expiring", expiresAt: pastExpiry }) as Record<string, unknown>;

      // Import ShareStore directly to test getByToken cleanup
      const { ShareStore } = await import("../../src-engine/src/db/share-store.js");
      const ss = new ShareStore(testDir);
      const found = ss.getByToken(share.token as string);
      expect(found).toBeUndefined(); // auto-cleaned

      // Verify removed from list
      const shares = await methodHandlers["share.list"]({ runId: run.id }) as Array<Record<string, unknown>>;
      expect(shares.find(s => s.token === share.token)).toBeUndefined();
    });

    it("should not revoke non-expired token on access", async () => {
      const run = await createRun();
      const futureExpiry = Date.now() + 86400_000;
      const share = await methodHandlers["share.create"]({ runId: run.id, label: "future", expiresAt: futureExpiry }) as Record<string, unknown>;

      const { ShareStore } = await import("../../src-engine/src/db/share-store.js");
      const ss = new ShareStore(testDir);
      const found = ss.getByToken(share.token as string);
      expect(found).toBeDefined();
      expect(found!.token).toBe(share.token);
    });
  });

  // ─── Full lifecycle: create → list → revoke → verify empty ────────────

  describe("Full share lifecycle", () => {
    it("should handle create-list-revoke-verify flow", async () => {
      const run = await createRun();

      // Create multiple tokens
      const t1 = await methodHandlers["share.create"]({ runId: run.id, label: "first" }) as Record<string, unknown>;
      const t2 = await methodHandlers["share.create"]({ runId: run.id, label: "second", expiresAt: Date.now() + 3600_000 }) as Record<string, unknown>;

      // List shows both
      let shares = await methodHandlers["share.list"]({ runId: run.id }) as Array<Record<string, unknown>>;
      expect(shares).toHaveLength(2);

      // Revoke first
      await methodHandlers["share.revoke"]({ token: t1.token as string });

      // List shows only second
      shares = await methodHandlers["share.list"]({ runId: run.id }) as Array<Record<string, unknown>>;
      expect(shares).toHaveLength(1);
      expect(shares[0].token).toBe(t2.token);
      expect(shares[0].label).toBe("second");
      expect(shares[0].expiresAt).toBeTypeOf("number");

      // Revoke second
      await methodHandlers["share.revoke"]({ token: t2.token as string });

      // List empty
      shares = await methodHandlers["share.list"]({ runId: run.id }) as Array<Record<string, unknown>>;
      expect(shares).toHaveLength(0);
    });
  });
});
