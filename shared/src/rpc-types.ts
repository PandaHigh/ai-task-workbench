export interface RpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: RpcError;
}

export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type RpcMessage = RpcRequest | RpcResponse | RpcNotification;

export const RPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: "Parse error" },
  INVALID_REQUEST: { code: -32600, message: "Invalid request" },
  METHOD_NOT_FOUND: { code: -32601, message: "Method not found" },
  INVALID_PARAMS: { code: -32602, message: "Invalid params" },
  INTERNAL_ERROR: { code: -32603, message: "Internal error" },
} as const;

export type EngineMethod =
  | "task.create"
  | "task.start"
  | "task.pause"
  | "task.resume"
  | "task.cancel"
  | "task.retry"
  | "task.delete"
  | "task.update"
  | "task.setTimeout"
  | "queue.list"
  | "queue.remove"
  | "queue.reorder"
  | "wizard.start"
  | "wizard.chat"
  | "wizard.validate"
  | "run.create"
  | "run.report"
  | "run.list"
  | "run.tasks"
  | "run.commits"
  | "run.lessons"
  | "run.logs"
  | "run.stop"
  | "run.delete"
  | "run.update"
  | "config.get"
  | "config.set"
  | "share.create"
  | "share.list"
  | "share.revoke"
  | "share.subscribe"
  | "share.unsubscribe"
  | "share.subscriptions"
  | "run.pauseGoal"
  | "run.resumeGoal"
  | "run.clearGoal"
  | "approval.respond"
  | "session.identify"
  | "session.list"
  | "activity.list"
  | "comment.create"
  | "comment.list"
  | "skill.list"
  | "skill.delete"
  | "crew.list"
  | "crew.configure"
  | "plugin.list"
  | "plugin.install"
  | "plugin.remove"
  | "plugin.toggle"
  | "config.adaptive"
  | "profile.list"
  | "profile.get"
  | "profile.set"
  | "profile.delete"
  | "metrics.snapshot"
  | "chat.send"
  | "chat.history"
  | "chat.clear"
  | "router.analyze"
  | "workflow.list"
  | "workflow.generate"
  | "workflow.start"
  | "workflow.pause"
  | "workflow.resume"
  | "workflow.cancel"
  | "workflow.status"
  | "workflow.save"
  | "wecom.status"
  | "wecom.test"
  | "project.probe"
;

export type EngineNotification =
  | "task.progress"
  | "task.status"
  | "task.scored"
  | "queue.updated"
  | "run.status"
  | "log.entry"
  | "git.commit"
  | "goal.updated"
  | "approval.requested"
  | "approval.resolved"
  | "task.stream"
  | "presence.joined"
  | "presence.left"
  | "activity.created"
  | "comment.created"
  | "skill.added"
  | "skill.removed"
  | "plugin.updated"
  | "agent.progress"
  | "chat.stream"
  | "chat.complete"
  | "chat.error"
  | "router.decision"
  | "workflow.started"
  | "workflow.phase.started"
  | "workflow.phase.completed"
  | "workflow.phase.failed"
  | "workflow.agent.started"
  | "workflow.agent.completed"
  | "workflow.adversarial.vote"
  | "workflow.loop.iteration"
  | "workflow.completed"
  | "workflow.error"
;
