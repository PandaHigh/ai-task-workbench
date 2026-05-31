import { randomUUID } from "crypto";
import type { ScheduledJob } from "@ai-workbench/shared";
import { CronJob } from "cron";

type RunTrigger = (job: ScheduledJob) => Promise<void>;

export class TaskScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private cronJobs = new Map<string, CronJob>();
  private triggerFn: RunTrigger;
  private runningJobs = new Set<string>();

  constructor(triggerFn: RunTrigger) {
    this.triggerFn = triggerFn;
  }

  loadJobs(jobs: ScheduledJob[]): void {
    for (const job of jobs) {
      this.jobs.set(job.id, job);
      if (job.enabled) {
        this.startCron(job);
      }
    }
  }

  addJob(params: Omit<ScheduledJob, "id" | "createdAt">): ScheduledJob {
    const job: ScheduledJob = {
      ...params,
      id: randomUUID(),
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    if (job.enabled) {
      this.startCron(job);
    }
    return job;
  }

  removeJob(id: string): boolean {
    this.stopCron(id);
    return this.jobs.delete(id);
  }

  toggleJob(id: string, enabled: boolean): ScheduledJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.enabled = enabled;
    if (enabled) {
      this.startCron(job);
    } else {
      this.stopCron(id);
    }
    return job;
  }

  listJobs(): ScheduledJob[] {
    return [...this.jobs.values()];
  }

  getJob(id: string): ScheduledJob | undefined {
    return this.jobs.get(id);
  }

  stopAll(): void {
    for (const [id] of this.cronJobs) {
      this.stopCron(id);
    }
  }

  private startCron(job: ScheduledJob): void {
    this.stopCron(job.id);
    try {
      const cronJob = new CronJob(
        job.cronExpr,
        () => this.executeJob(job.id),
        null,
        true,
      );
      this.cronJobs.set(job.id, cronJob);
      job.nextRunAt = cronJob.nextDate()?.toMillis();
    } catch (err) {
      console.warn(`[scheduler] Invalid cron expression for job ${job.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  private stopCron(id: string): void {
    const cronJob = this.cronJobs.get(id);
    if (cronJob) {
      cronJob.stop();
      this.cronJobs.delete(id);
    }
  }

  private async executeJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || !job.enabled) return;

    // Prevent overlapping runs
    if (this.runningJobs.has(jobId)) {
      console.warn(`[scheduler] Job ${job.name} (${jobId}) skipped — previous run still active`);
      return;
    }

    this.runningJobs.add(jobId);
    try {
      await this.triggerFn(job);
      job.lastRunAt = Date.now();
    } catch (err) {
      console.warn(`[scheduler] Job ${job.name} (${jobId}) failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.runningJobs.delete(jobId);
    }

    // Update nextRunAt
    const cronJob = this.cronJobs.get(jobId);
    if (cronJob) {
      job.nextRunAt = cronJob.nextDate()?.toMillis();
    }
  }
}
