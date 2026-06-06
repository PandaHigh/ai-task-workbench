/**
 * Loop Scheduler — 自适应定时任务调度
 *
 * 对应 Claude Code 的 /loop 功能。
 * 管理定时任务，间隔根据观察结果动态调整。
 */

import type { QueueManager } from "../queue-manager.js";

// ─── 类型 ────────────────────────────────────────────────────────────────

export interface LoopDefinition {
  id: string;
  /** 任务模板内容 */
  taskTemplate: string;
  /** 最小间隔（秒） */
  intervalMinSec: number;
  /** 最大间隔（秒） */
  intervalMaxSec: number;
  /** 当前间隔（秒） */
  currentIntervalSec: number;
  /** 停止条件（自然语言描述） */
  stopCondition?: string;
  /** 关联的 runId */
  runId: string;
  /** 创建时间 */
  createdAt: number;
  /** 上次执行时间 */
  lastExecutedAt?: number;
  /** 执行历史 */
  history: LoopExecution[];
  /** 是否活跃 */
  active: boolean;
}

export interface LoopExecution {
  timestamp: number;
  result: string;
  /** 执行结果是否有变化 */
  hadChanges: boolean;
  durationMs: number;
}

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

// ─── Loop Scheduler ─────────────────────────────────────────────────────

export class LoopScheduler {
  private loops = new Map<string, LoopDefinition>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private queueManager: QueueManager | null = null;
  private notify: NotifyFn;
  /** 执行回调（外部注入） */
  private onExecute: ((loop: LoopDefinition) => Promise<{ result: string; hadChanges: boolean }>) | null = null;

  constructor(notify: NotifyFn) {
    this.notify = notify;
  }

  /** 注入依赖 */
  setQueueManager(qm: QueueManager): void {
    this.queueManager = qm;
  }

  /** 设置执行回调 */
  setExecuteCallback(cb: (loop: LoopDefinition) => Promise<{ result: string; hadChanges: boolean }>): void {
    this.onExecute = cb;
  }

  /**
   * 创建一个定时循环任务。
   */
  create(
    loop: Omit<LoopDefinition, "currentIntervalSec" | "createdAt" | "history" | "active" | "lastExecutedAt">,
  ): LoopDefinition {
    const def: LoopDefinition = {
      ...loop,
      currentIntervalSec: loop.intervalMinSec,
      createdAt: Date.now(),
      history: [],
      active: true,
    };
    this.loops.set(def.id, def);
    this.scheduleNext(def.id);
    this.notify("loop.created", { loopId: def.id, runId: def.runId, intervalSec: def.currentIntervalSec });
    return def;
  }

  /**
   * 取消一个循环任务。
   */
  cancel(loopId: string): boolean {
    const loop = this.loops.get(loopId);
    if (!loop) return false;

    const timer = this.timers.get(loopId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(loopId);
    }

    loop.active = false;
    this.notify("loop.cancelled", { loopId });
    return true;
  }

  /**
   * 列出所有循环任务。
   */
  list(runId?: string): LoopDefinition[] {
    const all = [...this.loops.values()];
    if (runId) return all.filter((l) => l.runId === runId);
    return all;
  }

  /**
   * 恢复持久化的循环任务（引擎重启时调用）。
   */
  restore(loops: LoopDefinition[]): void {
    for (const loop of loops) {
      this.loops.set(loop.id, loop);
      if (loop.active) {
        this.scheduleNext(loop.id);
      }
    }
  }

  /** 获取所有活跃 loop（用于持久化） */
  getActiveLoops(): LoopDefinition[] {
    return [...this.loops.values()].filter((l) => l.active);
  }

  /** 关闭所有定时器 */
  shutdown(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  // ─── 内部方法 ────────────────────────────────────────────────────────

  private scheduleNext(loopId: string): void {
    const loop = this.loops.get(loopId);
    if (!loop || !loop.active) return;

    const delayMs = loop.currentIntervalSec * 1000;
    const timer = setTimeout(() => this.executeLoop(loopId), delayMs);
    this.timers.set(loopId, timer);
  }

  private async executeLoop(loopId: string): Promise<void> {
    const loop = this.loops.get(loopId);
    if (!loop || !loop.active) return;

    const startTime = Date.now();

    try {
      let result = "";
      let hadChanges = false;

      if (this.onExecute) {
        const execResult = await this.onExecute(loop);
        result = execResult.result;
        hadChanges = execResult.hadChanges;
      } else if (this.queueManager) {
        // 默认行为：将任务模板入队
        const task = this.queueManager.enqueue(loop.runId, {
          content: loop.taskTemplate,
          type: "smart_task",
          priority: 5,
        });
        result = `Enqueued task: ${task.content.substring(0, 80)}`;
        hadChanges = true;
      }

      const execution: LoopExecution = {
        timestamp: Date.now(),
        result,
        hadChanges,
        durationMs: Date.now() - startTime,
      };
      loop.history.push(execution);
      loop.lastExecutedAt = Date.now();

      // 自适应调整间隔
      this.adjustInterval(loop, hadChanges);

      this.notify("loop.executed", {
        loopId,
        hadChanges,
        newIntervalSec: loop.currentIntervalSec,
        result: result.substring(0, 200),
      });

      // 检查停止条件
      if (this.shouldStop(loop)) {
        loop.active = false;
        this.notify("loop.stopped", { loopId, reason: "Stop condition met" });
        return;
      }

      // 调度下一次执行
      this.scheduleNext(loopId);
    } catch (err) {
      this.notify("loop.error", {
        loopId,
        error: err instanceof Error ? err.message : String(err),
      });
      // 出错后仍然继续（延长间隔）
      loop.currentIntervalSec = Math.min(loop.currentIntervalSec * 2, loop.intervalMaxSec);
      this.scheduleNext(loopId);
    }
  }

  /** 自适应调整间隔 */
  private adjustInterval(loop: LoopDefinition, hadChanges: boolean): void {
    if (hadChanges) {
      // 有变化 → 缩短间隔（更频繁检查）
      loop.currentIntervalSec = Math.max(loop.intervalMinSec, loop.currentIntervalSec * 0.8);
    } else {
      // 无变化 → 延长间隔（减少浪费）
      loop.currentIntervalSec = Math.min(loop.intervalMaxSec, loop.currentIntervalSec * 1.3);
    }
  }

  /** 检查是否满足停止条件 */
  private shouldStop(loop: LoopDefinition): boolean {
    // 连续 5 次无变化则停止
    const recentExecutions = loop.history.slice(-5);
    if (recentExecutions.length >= 5 && recentExecutions.every((e) => !e.hadChanges)) {
      return true;
    }

    // 执行次数上限（防止无限运行）
    if (loop.history.length >= 100) {
      return true;
    }

    return false;
  }
}
