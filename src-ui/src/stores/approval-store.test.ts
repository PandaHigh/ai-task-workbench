import { describe, it, expect, beforeEach } from "vitest";
import { useApprovalStore } from "./approval-store";

describe("approval-store", () => {
  beforeEach(() => {
    useApprovalStore.setState({
      pendingApprovals: [],
      streamMessages: new Map(),
    });
  });

  it("should add approval", () => {
    const request = { id: "a1", runId: "r1", taskId: "t1", checkpointType: "borderline_score", summary: "test" };
    useApprovalStore.getState().addApproval(request as any);
    expect(useApprovalStore.getState().pendingApprovals).toHaveLength(1);
  });

  it("should remove approval", () => {
    useApprovalStore.getState().addApproval({ id: "a1" } as any);
    useApprovalStore.getState().addApproval({ id: "a2" } as any);
    useApprovalStore.getState().removeApproval("a1");
    expect(useApprovalStore.getState().pendingApprovals).toHaveLength(1);
    expect(useApprovalStore.getState().pendingApprovals[0].id).toBe("a2");
  });

  it("should clear all approvals", () => {
    useApprovalStore.getState().addApproval({ id: "a1" } as any);
    useApprovalStore.getState().clearApprovals();
    expect(useApprovalStore.getState().pendingApprovals).toHaveLength(0);
  });

  it("should append stream messages", () => {
    useApprovalStore.getState().appendStreamMessage("t1", { type: "assistant", content: "hi" });
    useApprovalStore.getState().appendStreamMessage("t1", { type: "user", content: "hello" });
    const msgs = useApprovalStore.getState().streamMessages.get("t1");
    expect(msgs).toHaveLength(2);
  });

  it("should cap stream messages around 200", () => {
    for (let i = 0; i < 250; i++) {
      useApprovalStore.getState().appendStreamMessage("t1", { type: "info", content: i });
    }
    const msgs = useApprovalStore.getState().streamMessages.get("t1");
    // slice(-200) keeps last 200 + 1 new = 201 max per append
    expect(msgs!.length).toBeLessThanOrEqual(201);
  });

  it("should clear stream messages for a task", () => {
    useApprovalStore.getState().appendStreamMessage("t1", { type: "assistant", content: "hi" });
    useApprovalStore.getState().clearStreamMessages("t1");
    expect(useApprovalStore.getState().streamMessages.has("t1")).toBe(false);
  });

  it("should update approval status by removing", () => {
    useApprovalStore.getState().addApproval({ id: "a1" } as any);
    useApprovalStore.getState().updateApprovalStatus("a1", "approved");
    expect(useApprovalStore.getState().pendingApprovals).toHaveLength(0);
  });

  it("should isolate stream messages per task", () => {
    useApprovalStore.getState().appendStreamMessage("t1", { type: "assistant" });
    useApprovalStore.getState().appendStreamMessage("t2", { type: "user" });
    expect(useApprovalStore.getState().streamMessages.get("t1")).toHaveLength(1);
    expect(useApprovalStore.getState().streamMessages.get("t2")).toHaveLength(1);
  });
});
