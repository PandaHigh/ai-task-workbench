import { WsServer } from "./ws-server.js";
import { setNotifyFn, shutdown, recoverStaleRuns, store, shareStore, queueManager } from "./json-rpc/methods.js";
import { killAllActiveProcesses } from "./cc-integration/cc-client.js";

let isShuttingDown = false;

async function main() {
  const wsServer = new WsServer({ store, shareStore, queueManager });

  setNotifyFn((method: string, params: Record<string, unknown>) => {
    wsServer.broadcast(method, params);
  });

  wsServer.start();

  const recovery = recoverStaleRuns();
  if (recovery.runsReset > 0 || recovery.tasksReset > 0) {
    console.log(`[engine] Crash recovery: ${recovery.runsReset} runs reset, ${recovery.tasksReset} tasks reset to pending`);
  }

  const gracefulShutdown = async () => {
    if (isShuttingDown) {
      console.warn("\nForce exit (second signal)");
      process.exit(1);
    }
    isShuttingDown = true;
    console.log("\nShutting down gracefully...");

    await killAllActiveProcesses();

    let shutdownOk = true;
    try {
      shutdown();
      await wsServer.close();
    } catch (err) {
      console.error("Error during shutdown:", err);
      shutdownOk = false;
    }
    process.exit(shutdownOk ? 0 : 1);
  };

  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);

  process.on("uncaughtException", (err) => {
    console.error("[engine] Uncaught exception — initiating shutdown:", err);
    gracefulShutdown();
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[engine] Unhandled rejection:", reason);
  });
}

main().catch((err) => {
  console.error("Engine failed to start:", err);
  process.exit(1);
});
