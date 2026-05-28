import type { ApprovalRequest, CheckpointType, ApprovalStatus } from "@ai-workbench/shared";
import crypto from "crypto";
import type { Store } from "../db/store.js";

type NotifyFn = (method: string, params: Record<string, unknown>) => void;

export interface ApprovalDecision {
  action: "approve" | "reject" | "modify";
  instructions?: string;
  modifications?: Record<string, unknown>;
  timedOut?: boolean;
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class ApprovalGate {
  private resolveFn: ((decision: ApprovalDecision) => void) | null = null;
  private rejectFn: ((err: Error) => void) | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private currentRequestId: string | null = null;

  constructor(
    private store: Store,
    private notify: NotifyFn,
  ) {}

  async waitForApproval(
    runId: string,
    taskId: string | undefined,
    checkpointType: CheckpointType,
    summary: string,
    contextData: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<ApprovalDecision> {
    const effectiveTimeout = timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;

    const request: ApprovalRequest = {
      id: crypto.randomUUID(),
      runId,
      taskId,
      checkpointType,
      status: "pending",
      createdAt: Date.now(),
      timeoutMs: effectiveTimeout,
      autoAction: "approve",
      summary,
      contextData,
    };

    this.currentRequestId = request.id;

    this.store.saveApprovalRequest(runId, request);
    this.notify("approval.requested", {
      approvalId: request.id,
      runId,
      taskId,
      checkpointType,
      summary,
      contextData,
      timeoutAt: Date.now() + effectiveTimeout,
    });

    return new Promise<ApprovalDecision>((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;

      this.timeoutTimer = setTimeout(() => {
        this.resolveInternal({
          action: request.autoAction,
          timedOut: true,
        });
      }, effectiveTimeout);
    });
  }

  resolve(approvalId: string, decision: ApprovalDecision): boolean {
    if (this.currentRequestId !== approvalId) return false;
    this.resolveInternal(decision);
    return true;
  }

  private resolveInternal(decision: ApprovalDecision): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }

    if (this.currentRequestId) {
      const status: ApprovalStatus = decision.timedOut
        ? "timed_out"
        : decision.action === "approve"
          ? "approved"
          : decision.action === "reject"
            ? "rejected"
            : "modified";

      this.store.updateApprovalRequest(
        "", // runId not needed for the update itself
        this.currentRequestId,
        {
          status,
          resolvedAt: Date.now(),
          decision: {
            action: decision.action,
            instructions: decision.instructions,
            modifications: decision.modifications,
          },
        },
      );
    }

    this.currentRequestId = null;
    const fn = this.resolveFn;
    this.resolveFn = null;
    this.rejectFn = null;
    if (fn) fn(decision);
  }

  abort(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.currentRequestId = null;
    const fn = this.rejectFn;
    this.resolveFn = null;
    this.rejectFn = null;
    if (fn) fn(new Error("Executor stopped while waiting for approval"));
  }

  get pendingApprovalId(): string | null {
    return this.currentRequestId;
  }
}
