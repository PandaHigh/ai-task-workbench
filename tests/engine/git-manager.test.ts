import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("simple-git", () => ({
  default: vi.fn(() => ({
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ commit: "abc1234" }),
    revert: vi.fn().mockResolvedValue(undefined),
    raw: vi.fn().mockResolvedValue(""),
    checkout: vi.fn().mockResolvedValue(undefined),
    clean: vi.fn().mockResolvedValue(undefined),
    addConfig: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue({ all: [] }),
    checkIsRepo: vi.fn().mockResolvedValue(false),
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { GitManager } from "../../src-engine/src/git/git-manager.js";

describe("GitManager", () => {
  let gm: GitManager;

  beforeEach(() => {
    vi.clearAllMocks();
    gm = new GitManager({ workingDir: "/tmp/test-project" });
  });

  it("should construct with workingDir", () => {
    expect(gm).toBeDefined();
  });

  it("should have autoCommit method", () => {
    expect(typeof gm.autoCommit).toBe("function");
  });

  it("should have revert method", () => {
    expect(typeof gm.revert).toBe("function");
  });

  it("should have checkoutClean method", () => {
    expect(typeof gm.checkoutClean).toBe("function");
  });

  it("should have initIfNeeded method", () => {
    expect(typeof gm.initIfNeeded).toBe("function");
  });

  it("should have getLastNCommits method", () => {
    expect(typeof gm.getLastNCommits).toBe("function");
  });
});
