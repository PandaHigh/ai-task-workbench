import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetDataDir = vi.fn();
const mockEnsureDir = vi.fn();
const mockReadJsonFile = vi.fn();
const mockWriteJsonFile = vi.fn();

vi.mock("../../src-engine/src/db/store-utils.js", () => ({
  getDataDir: mockGetDataDir,
  ensureDir: mockEnsureDir,
  readJsonFile: mockReadJsonFile,
  writeJsonFile: mockWriteJsonFile,
}));

// ── Import after mocks ─────────────────────────────────────────────────────

const { SubscriptionStore } = await import("../../src-engine/src/db/subscription-store.js");

// ── Helpers ────────────────────────────────────────────────────────────────

import type { Subscription } from "@ai-workbench/shared";

const baseSub = {
  runId: "run-1",
  remoteUrl: "https://remote.example.com",
  remoteToken: "token-abc",
  remoteRunId: "remote-run-1",
  label: "My Subscription",
};

const makeSub = (overrides: Partial<Subscription> = {}): Subscription => ({
  ...baseSub,
  subscribedAt: 1000,
  lastSyncedAt: 1000,
  ...overrides,
});

describe("SubscriptionStore", () => {
  let store: InstanceType<typeof SubscriptionStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDataDir.mockReturnValue("/data");
    mockReadJsonFile.mockReturnValue([]);
    store = new SubscriptionStore();
  });

  // ── subscribe ────────────────────────────────────────────────────────

  it("subscribe creates new subscription with timestamps", () => {
    mockReadJsonFile.mockReturnValue([]);
    const result = store.subscribe(baseSub);

    expect(result.runId).toBe("run-1");
    expect(result.remoteUrl).toBe("https://remote.example.com");
    expect(result.remoteToken).toBe("token-abc");
    expect(result.remoteRunId).toBe("remote-run-1");
    expect(result.label).toBe("My Subscription");
    expect(typeof result.subscribedAt).toBe("number");
    expect(typeof result.lastSyncedAt).toBe("number");

    expect(mockWriteJsonFile).toHaveBeenCalledWith("/data/subscriptions.json", [result]);
  });

  it("subscribe is idempotent (same URL + token returns existing)", () => {
    const existing = makeSub();
    mockReadJsonFile.mockReturnValue([existing]);

    const result = store.subscribe(baseSub);

    // Should return the existing entry without creating a new one
    expect(result).toEqual(existing);
    expect(mockWriteJsonFile).not.toHaveBeenCalled();
  });

  // ── list ─────────────────────────────────────────────────────────────

  it("list returns all subscriptions", () => {
    const sub1 = makeSub();
    const sub2 = makeSub({ runId: "run-2", remoteUrl: "https://other.com" });
    mockReadJsonFile.mockReturnValue([sub1, sub2]);

    const result = store.list();
    expect(result).toHaveLength(2);
    expect(result).toEqual([sub1, sub2]);
  });

  // ── getByRunId ───────────────────────────────────────────────────────

  it("getByRunId returns matching subscription", () => {
    const sub = makeSub();
    mockReadJsonFile.mockReturnValue([sub]);

    const result = store.getByRunId("run-1");
    expect(result).toBeDefined();
    expect(result!.runId).toBe("run-1");
  });

  it("getByRunId returns undefined for not found", () => {
    mockReadJsonFile.mockReturnValue([makeSub()]);
    const result = store.getByRunId("nonexistent");
    expect(result).toBeUndefined();
  });

  // ── unsubscribe ──────────────────────────────────────────────────────

  it("unsubscribe removes and returns true", () => {
    const sub = makeSub();
    mockReadJsonFile.mockReturnValue([sub]);

    const result = store.unsubscribe("run-1");
    expect(result).toBe(true);
    expect(mockWriteJsonFile).toHaveBeenCalledWith("/data/subscriptions.json", []);
  });

  it("unsubscribe returns false for not found", () => {
    mockReadJsonFile.mockReturnValue([makeSub()]);
    const result = store.unsubscribe("nonexistent");
    expect(result).toBe(false);
    expect(mockWriteJsonFile).not.toHaveBeenCalled();
  });

  // ── updateLastSync ───────────────────────────────────────────────────

  it("updateLastSync updates timestamp", () => {
    const sub = makeSub({ lastSyncedAt: 1000 });
    mockReadJsonFile.mockReturnValue([sub]);

    store.updateLastSync("run-1");

    expect(mockWriteJsonFile).toHaveBeenCalledWith("/data/subscriptions.json", [
      expect.objectContaining({ lastSyncedAt: expect.any(Number) }),
    ]);

    // Verify the timestamp was updated
    const writtenArg = mockWriteJsonFile.mock.calls[0][1] as Subscription[];
    expect(writtenArg[0].lastSyncedAt).not.toBe(1000);
  });

  it("updateLastSync is no-op for not found", () => {
    mockReadJsonFile.mockReturnValue([makeSub()]);
    store.updateLastSync("nonexistent");
    expect(mockWriteJsonFile).not.toHaveBeenCalled();
  });
});
