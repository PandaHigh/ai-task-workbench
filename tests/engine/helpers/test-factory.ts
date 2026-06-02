import fs from "fs";
import path from "path";
import os from "os";
import { vi } from "vitest";

/**
 * Create a temporary data directory for isolated tests.
 * Returns the directory path. Caller is responsible for cleanup.
 */
export function createTestDir(prefix = "ai-workbench-test"): string {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Remove a test directory. Safe to call if dir doesn't exist.
 */
export function cleanupTestDir(dir: string): void {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Mock all engine stores (Store, ShareStore, SubscriptionStore)
 * to use a temporary directory. Returns vi.doMock calls and the testDir.
 *
 * Usage:
 *   const { testDir, mockStores } = mockEngineStores();
 *   // ... in afterEach: cleanupTestDir(testDir);
 */
export function mockEngineStores() {
  const testDir = createTestDir();

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

  return { testDir };
}

/**
 * Mock CCClient to return a successful evaluation result.
 */
export function mockCCClient(overrides?: { result?: string }) {
  const defaultResult = '{"isComplete": true, "progressReport": "Done", "completedGoals": ["g1"], "remainingGoals": [], "overallProgress": 1}';
  vi.doMock("../../src-engine/src/cc-integration/cc-client.js", () => ({
    CCClient: vi.fn(() => ({
      executeTask: vi.fn(async () => ({
        result: overrides?.result ?? defaultResult,
        sessionId: "s-test",
        totalCostUsd: 0,
        durationMs: 0,
        numTurns: 0,
        messages: [],
      })),
    })),
  }));
}

/**
 * Mock GitManager with default no-op implementations.
 */
export function mockGitManager(overrides?: Record<string, ReturnType<typeof vi.fn>>) {
  vi.doMock("../../src-engine/src/git/git-manager.js", () => ({
    GitManager: vi.fn(() => ({
      ensureInit: vi.fn(async () => {}),
      autoCommit: vi.fn(async () => "abc1234"),
      revert: vi.fn(async () => {}),
      checkoutClean: vi.fn(async () => {}),
      getLastNCommits: vi.fn(async () => []),
      getDiffStats: vi.fn(async () => ({ filesChanged: 0, linesChanged: 0, hasCriticalFiles: false })),
      ...overrides,
    })),
  }));
}

/**
 * Convenience: mock all engine dependencies at once.
 * Returns testDir for cleanup.
 */
export function mockFullEngine() {
  const { testDir } = mockEngineStores();
  mockCCClient();
  mockGitManager();
  return { testDir };
}
