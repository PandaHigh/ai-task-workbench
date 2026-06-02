import { describe, it, expect, beforeEach, vi } from "vitest";

const mockStoreInstance = {
  appendComment: vi.fn(),
  getComments: vi.fn().mockReturnValue([]),
};

vi.doMock("../../src-engine/src/db/store.js", () => ({
  Store: vi.fn().mockImplementation(() => mockStoreInstance),
}));

vi.doMock("../../src-engine/src/lib/error-utils.js", () => ({
  errorToMessage: (err: unknown) => err instanceof Error ? err.message : String(err),
}));

vi.doMock("@ai-workbench/shared", () => ({
  roleToPermissions: (role: string) => {
    switch (role) {
      case "owner":
        return { role: "owner", canAddTask: true, canApproveTask: true, canEditQueue: true, canStartStop: true, canManageShare: true };
      case "collaborator":
        return { role: "collaborator", canAddTask: true, canApproveTask: true, canEditQueue: true, canStartStop: false, canManageShare: false };
      case "viewer":
        return { role: "viewer", canAddTask: false, canApproveTask: false, canEditQueue: false, canStartStop: false, canManageShare: false };
      default:
        return { role: "viewer", canAddTask: false, canApproveTask: false, canEditQueue: false, canStartStop: false, canManageShare: false };
    }
  },
}));

import { SessionManager } from "../../src-engine/src/engine/session-manager.js";

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreInstance.appendComment.mockReset();
    mockStoreInstance.getComments.mockReset().mockReturnValue([]);
    manager = new SessionManager(mockStoreInstance as any);
  });

  describe("identify", () => {
    it("creates session with defaults (userId, displayName, role)", () => {
      const session = manager.identify({});

      expect(session.userId).toBe("default-owner");
      expect(session.displayName).toBe("Owner");
      expect(session.role).toBe("owner");
      expect(session.sessionId).toBeDefined();
      expect(session.connectedAt).toBeTypeOf("number");
      expect(session.lastActiveAt).toBeTypeOf("number");
    });

    it("creates session with explicit params", () => {
      const session = manager.identify({
        userId: "user-123",
        displayName: "Alice",
        role: "collaborator",
        sessionId: "sess-abc",
      });

      expect(session.userId).toBe("user-123");
      expect(session.displayName).toBe("Alice");
      expect(session.role).toBe("collaborator");
      expect(session.sessionId).toBe("sess-abc");
    });

    it("uses userId as displayName when not owner and no displayName given", () => {
      const session = manager.identify({ userId: "bob" });
      expect(session.displayName).toBe("bob");
    });
  });

  describe("getBySessionId", () => {
    it("returns session by ID", () => {
      const created = manager.identify({ sessionId: "sess-1" });
      const found = manager.getBySessionId("sess-1");
      expect(found).toBe(created);
    });

    it("returns undefined for unknown sessionId", () => {
      expect(manager.getBySessionId("nonexistent")).toBeUndefined();
    });
  });

  describe("removeSession", () => {
    it("deletes session", () => {
      manager.identify({ sessionId: "sess-1" });
      manager.removeSession("sess-1");
      expect(manager.getBySessionId("sess-1")).toBeUndefined();
    });
  });

  describe("listActive", () => {
    it("returns all sessions", () => {
      manager.identify({ sessionId: "sess-1" });
      manager.identify({ sessionId: "sess-2" });
      const active = manager.listActive();
      expect(active).toHaveLength(2);
    });
  });

  describe("updateActivity", () => {
    it("updates lastActiveAt", () => {
      const session = manager.identify({ sessionId: "sess-1" });
      const before = session.lastActiveAt;

      // Use real timers for Date.now
      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);
      manager.updateActivity("sess-1");
      expect(session.lastActiveAt).toBeGreaterThanOrEqual(before);
      vi.useRealTimers();
    });

    it("sets currentPage", () => {
      const session = manager.identify({ sessionId: "sess-1" });
      manager.updateActivity("sess-1", "/dashboard");
      expect(session.currentPage).toBe("/dashboard");
    });

    it("no-ops for unknown sessionId", () => {
      // Should not throw
      manager.updateActivity("nonexistent", "/dashboard");
    });
  });

  describe("getPermission", () => {
    it("first user gets owner role", () => {
      const perm = manager.getPermission("default-owner", "run-1");
      expect(perm.userId).toBe("default-owner");
      expect(perm.role).toBe("owner");
      expect(perm.canStartStop).toBe(true);
    });

    it("subsequent users get collaborator role", () => {
      // First user
      manager.identify({ userId: "owner-1" });
      // Second user
      manager.identify({ userId: "user-2" });

      const perm = manager.getPermission("user-2", "run-1");
      expect(perm.userId).toBe("user-2");
      expect(perm.role).toBe("collaborator");
      expect(perm.canStartStop).toBe(false);
    });
  });

  describe("recordActivity", () => {
    it("returns activity event with correct fields", () => {
      const event = manager.recordActivity({
        userId: "user-1",
        action: "task.created",
        runId: "run-1",
        details: { taskId: "t-1" },
      });

      expect(event.id).toBeDefined();
      expect(event.userId).toBe("user-1");
      expect(event.action).toBe("task.created");
      expect(event.runId).toBe("run-1");
      expect(event.details).toEqual({ taskId: "t-1" });
      expect(event.timestamp).toBeTypeOf("number");
    });

    it("returns event even when no store persistence is available", () => {
      // Should not throw
      const event = manager.recordActivity({
        userId: "user-1",
        action: "task.started",
        runId: "run-1",
      });

      // Should still return the event
      expect(event).toBeDefined();
      expect(event.action).toBe("task.started");
    });
  });

  describe("getActivities", () => {
    it("returns empty array (activity persistence removed)", () => {
      const result = manager.getActivities("run-1");
      expect(result).toEqual([]);
    });

    it("returns empty array even with limit", () => {
      const result = manager.getActivities("run-1", 10);
      expect(result).toEqual([]);
    });
  });

  describe("addComment", () => {
    it("generates UUID and timestamp", () => {
      const comment = manager.addComment({
        taskId: "task-1",
        runId: "run-1",
        userId: "user-1",
        displayName: "Alice",
        content: "Looks good",
      });

      expect(comment.id).toBeDefined();
      expect(comment.id.length).toBeGreaterThan(0);
      expect(comment.createdAt).toBeTypeOf("number");
      expect(comment.taskId).toBe("task-1");
      expect(comment.runId).toBe("run-1");
      expect(comment.userId).toBe("user-1");
      expect(comment.displayName).toBe("Alice");
      expect(comment.content).toBe("Looks good");

      expect(mockStoreInstance.appendComment).toHaveBeenCalledWith("run-1", comment);
    });
  });

  describe("getComments", () => {
    it("returns all comments when no taskId filter", () => {
      const comments = [
        { id: "1", taskId: "task-1", runId: "run-1", userId: "u1", displayName: "A", content: "c1", createdAt: 1 },
        { id: "2", taskId: "task-2", runId: "run-1", userId: "u2", displayName: "B", content: "c2", createdAt: 2 },
      ];
      mockStoreInstance.getComments.mockReturnValue(comments);

      const result = manager.getComments("run-1");
      expect(result).toHaveLength(2);
    });

    it("filters by taskId", () => {
      const comments = [
        { id: "1", taskId: "task-1", runId: "run-1", userId: "u1", displayName: "A", content: "c1", createdAt: 1 },
        { id: "2", taskId: "task-2", runId: "run-1", userId: "u2", displayName: "B", content: "c2", createdAt: 2 },
      ];
      mockStoreInstance.getComments.mockReturnValue(comments);

      const result = manager.getComments("run-1", "task-1");
      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe("task-1");
    });

    it("returns [] on error", () => {
      mockStoreInstance.getComments.mockImplementation(() => {
        throw new Error("read error");
      });

      const result = manager.getComments("run-1");
      expect(result).toEqual([]);
    });
  });
});
