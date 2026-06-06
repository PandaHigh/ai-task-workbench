import path from "path";
import simpleGit from "simple-git";

export interface BranchResult {
  branchName: string;
  worktreePath: string;
}

export class BranchStrategy {
  /**
   * Create a feature branch and worktree for a task.
   * Returns the branch name and worktree path.
   */
  static async createTaskBranch(workingDir: string, taskId: string): Promise<BranchResult> {
    const git = simpleGit(workingDir);
    const shortId = taskId.substring(0, 8);
    const timestamp = Date.now().toString(36);
    const branchName = `task/${shortId}-${timestamp}`;
    const worktreePath = path.join(workingDir, ".worktrees", branchName.replace(/\//g, "-"));

    // Get current branch to restore later
    const status = await git.status();
    const currentBranch = status.current || "main";

    // Create branch from current HEAD without checking it out
    await git.raw(["branch", branchName]);

    // Create worktree directory
    const fs = await import("fs");
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    // Use git worktree add --checkout so the worktree checks out the branch
    try {
      await git.raw(["worktree", "add", "--checkout", worktreePath, branchName]);
    } catch (e) {
      // Cleanup the branch we just created
      try {
        await git.deleteLocalBranch(branchName);
      } catch {}
      // Fallback: checkout the branch in main working dir
      await git.checkout(branchName);
      return { branchName, worktreePath: workingDir };
    }

    // Ensure main working dir stays on the original branch
    try {
      await git.checkout(currentBranch);
    } catch {}

    return { branchName, worktreePath };
  }

  /**
   * Merge a task branch back into the main branch.
   * Returns true if merge succeeded, false if conflicts.
   */
  static async mergeBranch(
    workingDir: string,
    branchName: string,
    mainBranch: string = "main",
  ): Promise<{ success: boolean; conflicts?: string[] }> {
    const git = simpleGit(workingDir);

    try {
      // Checkout main branch
      await git.checkout(mainBranch);
      // Merge task branch
      await git.merge(["--no-ff", branchName]);
      return { success: true };
    } catch (err) {
      // Check for conflicts
      const status = await git.status();
      if (status.conflicted.length > 0) {
        // Abort merge to leave working dir clean
        await git.merge(["--abort"]).catch(() => {});
        return { success: false, conflicts: status.conflicted };
      }
      return { success: false, conflicts: [err instanceof Error ? err.message : String(err)] };
    }
  }

  /**
   * Clean up a task branch and its worktree.
   */
  static async cleanupBranch(workingDir: string, branchName: string, worktreePath: string): Promise<void> {
    const git = simpleGit(workingDir);
    const fs = await import("fs");

    // Remove worktree
    if (worktreePath !== workingDir && fs.existsSync(worktreePath)) {
      try {
        await git.raw(["worktree", "remove", worktreePath, "--force"]);
      } catch {
        // Force remove directory
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    // Delete branch
    try {
      await git.deleteLocalBranch(branchName);
    } catch {
      // Branch may already be gone
    }
  }

  /**
   * Generate a branch name for a task.
   */
  static getBranchName(taskId: string): string {
    const shortId = taskId.substring(0, 8);
    const timestamp = Date.now().toString(36);
    return `task/${shortId}-${timestamp}`;
  }
}
