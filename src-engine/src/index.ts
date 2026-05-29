import { WsServer } from "./ws-server.js";
import { setNotifyFn, shutdown, recoverStaleRuns, store, shareStore, subscriptionStore, queueManager, skillManager } from "./json-rpc/methods.js";
import { killAllActiveProcesses } from "./cc-integration/cc-client.js";
import { connectRemoteWS, disconnectRemoteWS } from "./remote/remote-proxy.js";
import { platform } from "os";

const isWin = platform() === "win32";
let isShuttingDown = false;

async function main() {
  const wsServer = new WsServer({ store, shareStore, queueManager });

  const notify = (method: string, params: Record<string, unknown>) => {
    wsServer.broadcast(method, params);
  };

  setNotifyFn(notify);

  skillManager.initBuiltinSkills();

  wsServer.start();

  // Resume remote subscription WebSocket connections
  for (const sub of subscriptionStore.list()) {
    try {
      connectRemoteWS(sub.runId, sub.remoteUrl, sub.remoteToken, notify);
    } catch (err) {
      console.warn(`[engine] Failed to resume remote WS for ${sub.runId}:`, err instanceof Error ? err.message : err);
    }
  }

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
    for (const sub of subscriptionStore.list()) {
      disconnectRemoteWS(sub.runId);
    }

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
  // SIGTERM is not supported on Windows; the Tauri sidecar uses TerminateProcess (hard kill).
  // On Windows, we handle cleanup via process exit hooks instead.
  if (!isWin) {
    process.on("SIGTERM", gracefulShutdown);
  }

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
