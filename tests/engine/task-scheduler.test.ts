import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskScheduler } from "../../src-engine/src/engine/task-scheduler.js";
import type { ScheduledJob } from "@ai-workbench/shared";

describe("TaskScheduler", () => {
  let scheduler: TaskScheduler;
  let triggerFn: ReturnType<typeof vi.fn>;
  let createdJobs: ScheduledJob[];

  beforeEach(() => {
    vi.useFakeTimers();
    triggerFn = vi.fn(async () => {});
    scheduler = new TaskScheduler(triggerFn);
    createdJobs = [];
  });

  afterEach(() => {
    scheduler.stopAll();
    vi.useRealTimers();
  });

  function addJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
    const job = scheduler.addJob({
      name: overrides.name ?? "test-job",
      cronExpr: overrides.cronExpr ?? "* * * * *",
      goals: overrides.goals ?? ["goal1"],
      workingDir: overrides.workingDir ?? "/tmp",
      enabled: overrides.enabled ?? true,
      createdAt: Date.now(),
      ...overrides,
    });
    createdJobs.push(job);
    return job;
  }

  describe("addJob", () => {
    it("should create a job with unique id", () => {
      const job = addJob();
      expect(job.id).toBeTruthy();
      expect(job.name).toBe("test-job");
      expect(job.enabled).toBe(true);
    });

    it("should create two jobs with different ids", () => {
      const j1 = addJob({ name: "job1" });
      const j2 = addJob({ name: "job2" });
      expect(j1.id).not.toBe(j2.id);
    });
  });

  describe("listJobs", () => {
    it("should return all jobs", () => {
      addJob({ name: "a" });
      addJob({ name: "b" });
      const list = scheduler.listJobs();
      expect(list).toHaveLength(2);
      expect(list.map((j) => j.name).sort()).toEqual(["a", "b"]);
    });

    it("should return empty array when no jobs", () => {
      expect(scheduler.listJobs()).toEqual([]);
    });
  });

  describe("getJob", () => {
    it("should return job by id", () => {
      const job = addJob();
      expect(scheduler.getJob(job.id)).toBe(job);
    });

    it("should return undefined for unknown id", () => {
      expect(scheduler.getJob("nonexistent")).toBeUndefined();
    });
  });

  describe("removeJob", () => {
    it("should remove a job", () => {
      const job = addJob();
      expect(scheduler.removeJob(job.id)).toBe(true);
      expect(scheduler.getJob(job.id)).toBeUndefined();
    });

    it("should return false for unknown id", () => {
      expect(scheduler.removeJob("nonexistent")).toBe(false);
    });
  });

  describe("toggleJob", () => {
    it("should disable an enabled job", () => {
      const job = addJob({ enabled: true });
      const updated = scheduler.toggleJob(job.id, false);
      expect(updated?.enabled).toBe(false);
    });

    it("should enable a disabled job", () => {
      const job = addJob({ enabled: false });
      const updated = scheduler.toggleJob(job.id, true);
      expect(updated?.enabled).toBe(true);
    });

    it("should return null for unknown id", () => {
      expect(scheduler.toggleJob("nonexistent", true)).toBeNull();
    });
  });

  describe("loadJobs", () => {
    it("should load existing jobs", () => {
      const jobs: ScheduledJob[] = [
        { id: "j1", name: "loaded-1", cronExpr: "* * * * *", goals: ["g1"], workingDir: "/tmp", enabled: true, createdAt: Date.now() },
        { id: "j2", name: "loaded-2", cronExpr: "0 * * * *", goals: ["g2"], workingDir: "/tmp", enabled: false, createdAt: Date.now() },
      ];
      scheduler.loadJobs(jobs);
      const list = scheduler.listJobs();
      expect(list).toHaveLength(2);
    });
  });

  describe("overlap prevention", () => {
    it("should skip execution if previous run is still active", async () => {
      let resolveFirst: () => void;
      const firstCall = new Promise<void>((r) => { resolveFirst = r; });
      let callCount = 0;

      const slowTrigger = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          await firstCall;
        }
      });

      const overlapScheduler = new TaskScheduler(slowTrigger);
      const job = overlapScheduler.addJob({
        name: "overlap-test",
        cronExpr: "* * * * *",
        goals: ["g"],
        workingDir: "/tmp",
        enabled: true,
        createdAt: Date.now(),
      });

      // Manually trigger executeJob twice without waiting
      const exec = (overlapScheduler as unknown as { executeJob: (id: string) => Promise<void> }).executeJob.bind(overlapScheduler);
      const p1 = exec(job.id);
      const p2 = exec(job.id);

      resolveFirst!();
      await Promise.all([p1, p2]);

      expect(slowTrigger).toHaveBeenCalledTimes(1);

      overlapScheduler.stopAll();
    });
  });

  describe("stopAll", () => {
    it("should stop all running cron jobs", () => {
      addJob({ enabled: true });
      addJob({ enabled: true });
      scheduler.stopAll();
      // No error means success — cron jobs cleaned up
      expect(scheduler.listJobs()).toHaveLength(2);
    });
  });
});
