import type { RpcRequest, RpcResponse, RpcNotification, RpcError } from "@ai-workbench/shared";
import { RPC_ERRORS } from "@ai-workbench/shared";
import { methodHandlers } from "./methods.js";

type PendingRequest = {
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
};

export interface JsonRpcServer {
  handleLine(line: string): void;
  notify(method: string, params?: Record<string, unknown>): void;
}

export function createRpcServer(): JsonRpcServer {
  const handlers = methodHandlers;

  function send(message: RpcResponse | RpcNotification): void {
    const data = JSON.stringify(message) + "\n";
    process.stdout.write(data);
  }

  function sendResponse(id: string | number, result: unknown): void {
    send({ jsonrpc: "2.0", id, result });
  }

  function sendError(id: string | number, error: RpcError): void {
    send({ jsonrpc: "2.0", id, error });
  }

  return {
    handleLine(line: string) {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        sendError(0, RPC_ERRORS.PARSE_ERROR);
        return;
      }

      if (!isValidRequest(message)) {
        sendError(0, RPC_ERRORS.INVALID_REQUEST);
        return;
      }

      const req = message as RpcRequest;
      const handler = handlers[req.method];

      if (!handler) {
        sendError(req.id, RPC_ERRORS.METHOD_NOT_FOUND);
        return;
      }

      Promise.resolve(handler(req.params || {}))
        .then((result) => sendResponse(req.id, result))
        .catch((err) => {
          sendError(req.id, {
            code: RPC_ERRORS.INTERNAL_ERROR.code,
            message: err instanceof Error ? err.message : String(err),
          });
        });
    },

    notify(method: string, params?: Record<string, unknown>) {
      send({ jsonrpc: "2.0", method, params: params || {} });
    },
  };
}

function isValidRequest(msg: unknown): msg is RpcRequest {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as Record<string, unknown>).jsonrpc === "2.0" &&
    typeof (msg as Record<string, unknown>).method === "string"
  );
}
