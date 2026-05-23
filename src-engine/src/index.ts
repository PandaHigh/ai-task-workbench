import { WsServer } from "./ws-server.js";
import { setNotifyFn } from "./json-rpc/methods.js";

async function main() {
  const wsServer = new WsServer();

  setNotifyFn((method: string, params: Record<string, unknown>) => {
    wsServer.broadcast(method, params);
  });

  wsServer.start();
}

main().catch((err) => {
  console.error("Engine failed to start:", err);
  process.exit(1);
});
