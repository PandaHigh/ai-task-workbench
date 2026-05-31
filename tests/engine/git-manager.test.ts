import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGitInstance = {
  add: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue({ commit: "abc1234567890" }),
  revert: vi.fn().mockResolvedValue(undefined),
  raw: vi.fn().mockResolvedValue(""),
  status: vi.fn().mockResolvedValue({ toString: () => "M file.ts" }),
  diff: vi.fn().mockResolvedValue("diff content"),
  log: vi.fn().mockResolvedValue({ all: [] }),
  checkIsRepo: vi.fn().mockResolvedValue(false),
  init: vi.fn().mockResolvedValue(undefined),
  addConfig: vi.fn().mockResolvedValue(undefined),
  push: vi.fn().mockResolvedValue({}),
  pull: vi.fn().mockResolvedValue({}),
  fetch: vi.fn().mockResolvedValue({}),
  addRemote: vi.fn().mockResolvedValue(undefined),
  getRemotes: vi.fn().mockResolvedValue([]),
  revparse: vi.fn().mockResolvedValue("main\n"),
};

vi.mock("simple-git", () => ({
  default: vi.fn(() => mockGitInstance),
}));

import { GitManager } from "../../src-engine/src/git/git-manager.js";

describe("GitManager", () => {
  let gm: GitManager;

  beforeEach(() => {
    vi.clearAllMocks();
    gm = new GitManager({ workingDir: "/tmp/test-project" });
  });

  describe("autoCommit", () => {
    it("should commit with formatted message", async () => {
      const hash = await gm.autoCommit("abc123", "Add feature");
      expect(mockGitInstance.add).toHaveBeenCalledWith("-A");
      expect(mockGitInstance.commit).toHaveBeenCalledWith("[abc123] Add feature #AI commit#");
      expect(hash).toBe("abc1234567890");
    });

    it("should truncate long content to 50 chars", async () => {
      const longContent = "A".repeat(60);
      await gm.autoCommit("task123456", longContent);
      const call = mockGitInstance.commit.mock.calls[0][0] as string;
      expect(call).toContain("...");
      expect(call.length).toBeLessThan(longContent.length + 20);
    });
  });

  describe("revert", () => {
    it("should revert a commit", async () => {
      await gm.revert("abc123");
      expect(mockGitInstance.revert).toHaveBeenCalledWith("abc123");
    });

    it("should abort revert on conflict and rethrow", async () => {
      const error = new Error("conflict");
      mockGitInstance.revert.mockRejectedValueOnce(error);
      mockGitInstance.raw.mockResolvedValueOnce(undefined);

      await expect(gm.revert("badhash")).rejects.toThrow("conflict");
      expect(mockGitInstance.raw).toHaveBeenCalledWith(["revert", "--abort"]);
    });
  });

  describe("checkoutClean", () => {
    it("should checkout and clean working tree", async () => {
      await gm.checkoutClean();
      expect(mockGitInstance.raw).toHaveBeenCalledWith(["checkout", "--", "."]);
      expect(mockGitInstance.raw).toHaveBeenCalledWith(["clean", "-fd"]);
    });
  });

  describe("ensureInit", () => {
    it("should init repo and set config when not a repo", async () => {
      mockGitInstance.checkIsRepo.mockResolvedValueOnce(false);
      await gm.ensureInit();
      expect(mockGitInstance.init).toHaveBeenCalled();
      expect(mockGitInstance.addConfig).toHaveBeenCalledWith("user.name", "AI Task Workbench");
      expect(mockGitInstance.addConfig).toHaveBeenCalledWith("user.email", "ai-workbench@local");
    });

    it("should skip init when already a repo", async () => {
      mockGitInstance.checkIsRepo.mockResolvedValueOnce(true);
      await gm.ensureInit();
      expect(mockGitInstance.init).not.toHaveBeenCalled();
    });
  });

  describe("getLastNCommits", () => {
    it("should return formatted commits", async () => {
      mockGitInstance.log.mockResolvedValueOnce({
        all: [
          { hash: "aaa", message: "feat: add #AI commit#", date: "2024-01-01" },
          { hash: "bbb", message: "fix: bug", date: "2024-01-02" },
        ],
      });
      const commits = await gm.getLastNCommits(2);
      expect(commits).toHaveLength(2);
      expect(commits[0].isAiCommit).toBe(true);
      expect(commits[1].isAiCommit).toBe(false);
      expect(commits[0].hash).toBe("aaa");
    });
  });

  describe("getStatus", () => {
    it("should return git status string", async () => {
      const status = await gm.getStatus();
      expect(typeof status).toBe("string");
      expect(mockGitInstance.status).toHaveBeenCalled();
    });
  });

  describe("getDiffSince", () => {
    it("should return diff since a hash", async () => {
      mockGitInstance.diff.mockResolvedValueOnce("diff --git a/file");
      const diff = await gm.getDiffSince("abc123");
      expect(diff).toBe("diff --git a/file");
      expect(mockGitInstance.diff).toHaveBeenCalledWith(["abc123"]);
    });
  });

  describe("push", () => {
    it("should push to remote with branch", async () => {
      const result = await gm.push("origin", "main");
      expect(mockGitInstance.push).toHaveBeenCalledWith("origin", "main");
      expect(result).toBe("Pushed");
    });

    it("should push to remote without branch", async () => {
      const result = await gm.push("origin");
      expect(mockGitInstance.push).toHaveBeenCalledWith("origin");
      expect(result).toBe("Pushed");
    });
  });

  describe("pull", () => {
    it("should pull from remote with branch", async () => {
      const result = await gm.pull("origin", "main");
      expect(mockGitInstance.pull).toHaveBeenCalledWith("origin", "main");
      expect(result).toBe("Pulled");
    });

    it("should pull from remote without branch", async () => {
      const result = await gm.pull("origin");
      expect(mockGitInstance.pull).toHaveBeenCalledWith("origin");
      expect(result).toBe("Pulled");
    });
  });

  describe("fetch", () => {
    it("should fetch from remote", async () => {
      const result = await gm.fetch("upstream");
      expect(mockGitInstance.fetch).toHaveBeenCalledWith(["upstream"]);
      expect(result).toBe("Fetched");
    });

    it("should default to origin", async () => {
      await gm.fetch();
      expect(mockGitInstance.fetch).toHaveBeenCalledWith(["origin"]);
    });
  });

  describe("addRemote", () => {
    it("should add a remote", async () => {
      await gm.addRemote("origin", "git@github.com:user/repo.git");
      expect(mockGitInstance.addRemote).toHaveBeenCalledWith("origin", "git@github.com:user/repo.git");
    });

    it("should ignore already exists error", async () => {
      mockGitInstance.addRemote.mockRejectedValueOnce(new Error("remote origin already exists"));
      await expect(gm.addRemote("origin", "git@github.com:user/repo.git")).resolves.toBeUndefined();
    });

    it("should throw non-already-exists errors", async () => {
      mockGitInstance.addRemote.mockRejectedValueOnce(new Error("other error"));
      await expect(gm.addRemote("origin", "url")).rejects.toThrow("other error");
    });
  });

  describe("listRemotes", () => {
    it("should return remotes", async () => {
      mockGitInstance.getRemotes.mockResolvedValueOnce([
        { name: "origin", refs: { fetch: "git@github.com:user/repo.git", push: "git@github.com:user/repo.git" } },
      ]);
      const remotes = await gm.listRemotes();
      expect(remotes).toHaveLength(1);
      expect(remotes[0].name).toBe("origin");
    });
  });

  describe("getCurrentBranch", () => {
    it("should return current branch name", async () => {
      mockGitInstance.revparse.mockResolvedValueOnce("feature-branch\n");
      const branch = await gm.getCurrentBranch();
      expect(branch).toBe("feature-branch");
    });
  });
});
