import crypto from "crypto";
import type { ClientSession, RunPermission, UserRole } from "@ai-workbench/shared";
import { roleToPermissions } from "@ai-workbench/shared";
import { Store } from "../db/store.js";
import { errorToMessage } from "../lib/error-utils.js";

const DEFAULT_OWNER = "default-owner";
const DEFAULT_OWNER_NAME = "Owner";

export class SessionManager {
  private sessions: Map<string, ClientSession> = new Map();
  private store: Store;

  constructor(store?: Store) {
    this.store = store ?? new Store();
  }

  identify(params: {
    userId?: string;
    displayName?: string;
    role?: UserRole;
    sessionId?: string;
  }): ClientSession {
    const userId = params.userId || DEFAULT_OWNER;
    const session: ClientSession = {
      sessionId: params.sessionId || crypto.randomUUID(),
      userId,
      displayName: params.displayName || (userId === DEFAULT_OWNER ? DEFAULT_OWNER_NAME : userId),
      role: params.role || "owner",
      connectedAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getBySessionId(sessionId: string): ClientSession | undefined {
    return this.sessions.get(sessionId);
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  listActive(): ClientSession[] {
    return [...this.sessions.values()];
  }

  updateActivity(sessionId: string, page?: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActiveAt = Date.now();
      if (page) session.currentPage = page;
    }
  }

  getPermission(userId: string, _runId: string): RunPermission {
    // For now: first user is owner, everyone else gets collaborator
    // In a full system this would look up stored permissions
    const isOwner = userId === DEFAULT_OWNER || this.isFirstUser(userId);
    const role: UserRole = isOwner ? "owner" : "collaborator";
    const perms = roleToPermissions(role);
    return { userId, ...perms };
  }

  private isFirstUser(userId: string): boolean {
    const sessions = this.listActive();
    const firstSession = sessions.sort((a, b) => a.connectedAt - b.connectedAt)[0];
    return firstSession?.userId === userId;
  }

  recordActivity(params: {
    userId: string;
    action: string;
    runId: string;
    details?: Record<string, unknown>;
  }): { id: string; timestamp: number; userId: string; action: string; details: Record<string, unknown>; runId: string } {
    const event = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      userId: params.userId,
      action: params.action,
      details: params.details ?? {},
      runId: params.runId,
    };

    console.log("[session-manager] Activity recorded:", event.action, "by", event.userId, "on run", event.runId);

    return event;
  }

  getActivities(_runId: string, _limit?: number): { id: string; timestamp: number; userId: string; action: string; details: Record<string, unknown>; runId: string }[] {
    return [];
  }

  addComment(params: {
    taskId: string;
    runId: string;
    userId: string;
    displayName: string;
    content: string;
  }): import("@ai-workbench/shared").TaskComment {
    const comment: import("@ai-workbench/shared").TaskComment = {
      id: crypto.randomUUID(),
      taskId: params.taskId,
      runId: params.runId,
      userId: params.userId,
      displayName: params.displayName,
      content: params.content,
      createdAt: Date.now(),
    };

    this.store.appendComment(params.runId, comment);
    return comment;
  }

  getComments(runId: string, taskId?: string): import("@ai-workbench/shared").TaskComment[] {
    try {
      const all = this.store.getComments(runId);
      if (taskId) return all.filter((c) => c.taskId === taskId);
      return all;
    } catch (err) { console.warn("[session] Failed to get comments:", errorToMessage(err));
      return [];
    }
  }
}
