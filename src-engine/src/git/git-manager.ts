import simpleGit, { type SimpleGit } from "simple-git";

export interface GitManagerOptions {
  workingDir: string;
}

export class GitManager {
  private git: SimpleGit;

  constructor(private options: GitManagerOptions) {
    this.git = simpleGit(options.workingDir);
  }

  async autoCommit(taskId: string, taskContent: string): Promise<string> {
    await this.git.add("-u");

    const shortId = taskId.substring(0, 6);
    const summary = taskContent.length > 50
      ? taskContent.substring(0, 47) + "..."
      : taskContent;
    const message = `[${shortId}] ${summary} #AI commit#`;

    const result = await this.git.commit(message);
    return result.commit;
  }

  async revert(commitHash: string): Promise<void> {
    try {
      await this.git.revert(commitHash);
    } catch (err) {
      // If revert has conflicts, abort it
      try { await this.git.raw(["revert", "--abort"]); } catch {}
      throw err;
    }
  }

  async checkoutClean(): Promise<void> {
    await this.git.raw(["checkout", "--", "."]);
    await this.git.raw(["clean", "-fd"]);
  }

  async getLastNCommits(n: number): Promise<Array<{
    hash: string;
    message: string;
    date: string;
    isAiCommit: boolean;
  }>> {
    const log = await this.git.log([`-n`, String(n)]);
    return log.all.map((entry) => ({
      hash: entry.hash,
      message: entry.message,
      date: entry.date,
      isAiCommit: entry.message.includes("#AI commit#"),
    }));
  }

  async getStatus(): Promise<string> {
    return this.git.status().then((s) => String(s));
  }

  async getDiffSince(hash: string): Promise<string> {
    return this.git.diff([hash]);
  }

  async initIfNeeded(): Promise<void> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      await this.git.init();
      await this.git.addConfig("user.name", "AI Task Workbench");
      await this.git.addConfig("user.email", "ai-workbench@local");
    }
  }
}
