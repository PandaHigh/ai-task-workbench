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
export declare const RPC_ERRORS: {
    readonly PARSE_ERROR: {
        readonly code: -32700;
        readonly message: "Parse error";
    };
    readonly INVALID_REQUEST: {
        readonly code: -32600;
        readonly message: "Invalid request";
    };
    readonly METHOD_NOT_FOUND: {
        readonly code: -32601;
        readonly message: "Method not found";
    };
    readonly INVALID_PARAMS: {
        readonly code: -32602;
        readonly message: "Invalid params";
    };
    readonly INTERNAL_ERROR: {
        readonly code: -32603;
        readonly message: "Internal error";
    };
};
export type EngineMethod = "task.create" | "task.start" | "task.pause" | "task.resume" | "task.cancel" | "task.retry" | "task.setTimeout" | "queue.list" | "queue.reorder" | "wizard.start" | "wizard.chat" | "wizard.validate" | "run.create" | "run.report" | "run.list" | "run.tasks" | "run.commits" | "run.lessons" | "run.logs" | "run.stop" | "run.delete" | "config.get" | "config.set" | "share.create" | "share.list" | "share.revoke" | "share.subscribe" | "share.unsubscribe" | "share.subscriptions" | "run.pauseGoal" | "run.resumeGoal" | "run.clearGoal" | "approval.respond" | "approval.inject" | "run.setExecutionMode" | "role.list" | "role.create" | "session.identify" | "session.list" | "activity.list" | "comment.create" | "comment.list";
export type EngineNotification = "task.progress" | "task.status" | "task.scored" | "queue.updated" | "run.status" | "log.entry" | "git.commit" | "goal.updated" | "approval.requested" | "approval.resolved" | "task.stream" | "features.generated" | "features.updated" | "presence.joined" | "presence.left" | "activity.created" | "comment.created";
//# sourceMappingURL=rpc-types.d.ts.map