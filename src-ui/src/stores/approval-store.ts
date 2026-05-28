import { create } from "zustand";
import type { ApprovalRequest, ApprovalStatus } from "@ai-workbench/shared";

interface StreamMessage {
  type: string;
  subtype?: string;
  content?: unknown;
  timestamp?: number;
}

interface ApprovalStore {
  pendingApprovals: ApprovalRequest[];
  streamMessages: Map<string, StreamMessage[]>;

  addApproval: (request: ApprovalRequest) => void;
  removeApproval: (approvalId: string) => void;
  clearApprovals: () => void;
  updateApprovalStatus: (approvalId: string, _s: ApprovalStatus) => void;
  appendStreamMessage: (taskId: string, message: StreamMessage) => void;
  clearStreamMessages: (taskId: string) => void;
}

export const useApprovalStore = create<ApprovalStore>((set) => ({
  pendingApprovals: [],
  streamMessages: new Map(),

  addApproval: (request) =>
    set((state) => ({
      pendingApprovals: [...state.pendingApprovals, request],
    })),

  removeApproval: (approvalId) =>
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((a) => a.id !== approvalId),
    })),

  clearApprovals: () => set({ pendingApprovals: [] }),

  updateApprovalStatus: (approvalId, _status) =>
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((a) => a.id !== approvalId),
    })),

  appendStreamMessage: (taskId, message) =>
    set((state) => {
      const newMap = new Map(state.streamMessages);
      const existing = newMap.get(taskId) ?? [];
      newMap.set(taskId, [...existing.slice(-200), message]);
      return { streamMessages: newMap };
    }),

  clearStreamMessages: (taskId) =>
    set((state) => {
      const newMap = new Map(state.streamMessages);
      newMap.delete(taskId);
      return { streamMessages: newMap };
    }),
}));
