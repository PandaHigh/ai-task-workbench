import simpleGit, { type SimpleGit } from "simple-git";
import path from "path";

export class WorktreeManager {
  private getGit(baseDir: string): SimpleGit {
    return simpleGit(baseDir);
  }

  async create(baseDir: string, branchName: string): Promise<string> {
    const git = this.getGit(baseDir);
    const worktreePath = path.join(baseDir, ".worktrees", branchName);

    // Create worktree with new branch
    await git.raw(["worktree", "add", worktreePath, "-b", branchName, "HEAD"]);

    return worktreePath;
  }

  async mergeChanges(baseDir: string, branchName: string): Promise<void> {
    const git = this.getGit(baseDir);

    // Merge the worker branch into current branch
    await git.merge(["--no-edit", branchName]);
  }

  async remove(baseDir: string, worktreePath: string, branchName: string): Promise<void> {
    const git = this.getGit(baseDir);

    // Remove worktree
    try {
      await git.raw(["worktree", "remove", worktreePath, "--force"]);
    } catch {
      // If worktree removal fails, try pruning
      try { await git.raw(["worktree", "prune"]); } catch { /* ignore */ }
    }

    // Delete the branch
    try {
      await git.deleteLocalBranch(branchName);
    } catch {
      // Branch may not exist if create failed
    }
  }

  async listWorktrees(baseDir: string): Promise<string[]> {
    const git = this.getGit(baseDir);
    const result = await git.raw(["worktree", "list", "--porcelain"]);
    return result
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.replace("worktree ", ""))
      .filter((path) => path !== baseDir);
  }

  async cleanupAll(baseDir: string): Promise<void> {
    const worktrees = await this.listWorktrees(baseDir);
    for (const wt of worktrees) {
      try {
        const git = this.getGit(baseDir);
        await git.raw(["worktree", "remove", wt, "--force"]);
      } catch {
        // ignore
      }
    }
    try {
      const git = this.getGit(baseDir);
      await git.raw(["worktree", "prune"]);
    } catch {
      // ignore
    }
  }
}
