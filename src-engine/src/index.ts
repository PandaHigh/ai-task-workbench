import { WsServer } from "./ws-server.js";
import { setNotifyFn, shutdown } from "./json-rpc/methods.js";

async function main() {
  const wsServer = new WsServer();

  setNotifyFn((method: string, params: Record<string, unknown>) => {
    wsServer.broadcast(method, params);
  });

  wsServer.start();

  const gracefulShutdown = () => {
    console.log("\nShutting down gracefully...");
    shutdown();
    wsServer.close();
    process.exit(0);
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);
}

main().catch((err) => {
  console.error("Engine failed to start:", err);
  process.exit(1);
});
