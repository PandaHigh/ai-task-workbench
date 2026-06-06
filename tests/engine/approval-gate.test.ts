import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the Store module before any imports that use it
vi.doMock("../../src-engine/src/db/store.js", () => ({
  Store: vi.fn().mockImplementation(() => ({
    saveApprovalRequest: vi.fn(),
    updateApprovalRequest: vi.fn(),
  })),
}));

import { ApprovalGate } from "../../src-engine/src/engine/approval-gate.js";
import type { Store } from "../../src-engine/src/db/store.js";

describe("ApprovalGate", () => {
  let gate: ApprovalGate;
  let mockStore: {
    saveApprovalRequest: ReturnType<typeof vi.fn>;
    updateApprovalRequest: ReturnType<typeof vi.fn>;
  };
  let mockNotify: ReturnType<typeof vi.fn>;

  /** Helper: start waitForApproval and capture the generated request ID from the store call */
  function startApproval(
    runId = "run-1",
    taskId = "task-1",
    checkpointType: "code" | "command" = "code",
    summary = "Summary",
    contextData: Record<string, unknown> = {},
    timeoutMs?: number,
  ) {
    const promise = gate.waitForApproval(runId, taskId, checkpointType, summary, contextData, timeoutMs);
    // The real crypto generates a UUID; extract it from the store call
    const call = mockStore.saveApprovalRequest.mock.calls[mockStore.saveApprovalRequest.mock.calls.length - 1];
    const requestId = call[1].id as string;
    return { promise, requestId };
  }

  beforeEach(() => {
    vi.useFakeTimers();

    mockStore = {
      saveApprovalRequest: vi.fn(),
      updateApprovalRequest: vi.fn(),
    };
    mockNotify = vi.fn();
    gate = new ApprovalGate(mockStore as unknown as Store, mockNotify);
  });

  describe("waitForApproval", () => {
    it("creates request, persists to store, and sends notification", async () => {
      const { promise, requestId } = startApproval("run-1", "task-1", "code", "Test summary", { key: "value" });

      // Should persist the request
      expect(mockStore.saveApprovalRequest).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({
          id: requestId,
          runId: "run-1",
          taskId: "task-1",
          checkpointType: "code",
          status: "pending",
          summary: "Test summary",
          contextData: { key: "value" },
          autoAction: "approve",
          timeoutMs: 30 * 60 * 1000,
        }),
      );

      // Should send notification
      expect(mockNotify).toHaveBeenCalledWith(
        "approval.requested",
        expect.objectContaining({
          approvalId: requestId,
          runId: "run-1",
          taskId: "task-1",
          checkpointType: "code",
          summary: "Test summary",
          contextData: { key: "value" },
        }),
      );

      // The notification should include timeoutAt
      const notifyCall = mockNotify.mock.calls[0][1] as Record<string, unknown>;
      expect(notifyCall.timeoutAt).toBeTypeOf("number");

      // Clean up: resolve so promise doesn't hang
      gate.resolve(requestId, { action: "approve" });
      await promise;
    });
  });

  describe("resolve", () => {
    it("returns false when no pending request", () => {
      const result = gate.resolve("nonexistent-id", { action: "approve" });
      expect(result).toBe(false);
    });

    it("returns false when ID mismatches", async () => {
      const { promise, requestId } = startApproval();

      const result = gate.resolve("wrong-id", { action: "approve" });
      expect(result).toBe(false);

      // Clean up with the real ID
      gate.resolve(requestId, { action: "approve" });
      await promise;
    });

    it("resolves the promise with approve action", async () => {
      const { promise, requestId } = startApproval();

      const result = gate.resolve(requestId, { action: "approve" });
      expect(result).toBe(true);

      const decision = await promise;
      expect(decision.action).toBe("approve");
    });

    it("resolves the promise with reject action", async () => {
      const { promise, requestId } = startApproval();

      gate.resolve(requestId, { action: "reject" });

      const decision = await promise;
      expect(decision.action).toBe("reject");
    });

    it("resolves the promise with modify action", async () => {
      const { promise, requestId } = startApproval();

      gate.resolve(requestId, {
        action: "modify",
        instructions: "Change this",
        modifications: { foo: "bar" },
      });

      const decision = await promise;
      expect(decision.action).toBe("modify");
      expect(decision.instructions).toBe("Change this");
      expect(decision.modifications).toEqual({ foo: "bar" });
    });

    it("clears timeout timer", async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

      const { promise, requestId } = startApproval();

      gate.resolve(requestId, { action: "approve" });
      await promise;

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it("updates store with approved status", async () => {
      const { promise, requestId } = startApproval();

      gate.resolve(requestId, { action: "approve" });
      await promise;

      expect(mockStore.updateApprovalRequest).toHaveBeenCalledWith(
        "",
        requestId,
        expect.objectContaining({
          status: "approved",
        }),
      );
    });

    it("updates store with rejected status", async () => {
      const { promise, requestId } = startApproval();

      gate.resolve(requestId, { action: "reject" });
      await promise;

      expect(mockStore.updateApprovalRequest).toHaveBeenCalledWith(
        "",
        requestId,
        expect.objectContaining({
          status: "rejected",
        }),
      );
    });

    it("updates store with modified status", async () => {
      const { promise, requestId } = startApproval();

      gate.resolve(requestId, { action: "modify" });
      await promise;

      expect(mockStore.updateApprovalRequest).toHaveBeenCalledWith(
        "",
        requestId,
        expect.objectContaining({
          status: "modified",
        }),
      );
    });
  });

  describe("timeout", () => {
    it("auto-resolves with autoAction and timedOut: true after default 30 min", async () => {
      const { promise, requestId } = startApproval();

      // Advance past default 30-minute timeout
      vi.advanceTimersByTime(30 * 60 * 1000);

      const decision = await promise;
      expect(decision.action).toBe("approve");
      expect(decision.timedOut).toBe(true);

      // Should update store with timed_out status
      expect(mockStore.updateApprovalRequest).toHaveBeenCalledWith(
        "",
        requestId,
        expect.objectContaining({
          status: "timed_out",
        }),
      );
    });

    it("respects custom timeout value", async () => {
      const { promise } = startApproval("run-1", "task-1", "code", "Summary", {}, 5000);

      vi.advanceTimersByTime(5000);

      const decision = await promise;
      expect(decision.timedOut).toBe(true);
    });
  });

  describe("abort", () => {
    it("rejects the pending promise", async () => {
      const promise = gate.waitForApproval("run-1", "task-1", "code", "Summary", {});

      gate.abort();

      await expect(promise).rejects.toThrow("Executor stopped while waiting for approval");
    });

    it("cleans up state (pendingApprovalId returns null)", async () => {
      const promise = gate.waitForApproval("run-1", "task-1", "code", "Summary", {});

      // There should be a pending ID
      expect(gate.pendingApprovalId).not.toBeNull();

      gate.abort();

      // After abort, pendingApprovalId should be null
      expect(gate.pendingApprovalId).toBeNull();

      // Handle the rejection to avoid unhandled rejection warning
      await promise.catch(() => {
        /* expected */
      });
    });
  });

  describe("pendingApprovalId", () => {
    it("returns null when no pending request", () => {
      expect(gate.pendingApprovalId).toBeNull();
    });

    it("returns the current request ID when waiting", () => {
      const { requestId } = startApproval();
      expect(gate.pendingApprovalId).toBe(requestId);
    });
  });
});
