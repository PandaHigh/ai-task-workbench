import { WsServer } from "./ws-server.js";
import { setNotifyFn, shutdown, recoverStaleRuns, store, shareStore, subscriptionStore, queueManager, skillManager, mcpManager } from "./json-rpc/methods.js";
import { killAllActiveProcesses } from "./cc-integration/cc-client.js";
import { connectRemoteWS, disconnectRemoteWS } from "./remote/remote-proxy.js";
import { log } from "./lib/logger.js";
import { platform } from "os";

const isWin = platform() === "win32";
let isShuttingDown = false;

async function main() {
  const wsServer = new WsServer({ store, shareStore, queueManager });

  const notify = (method: string, params: Record<string, unknown>) => {
    wsServer.broadcast(method, params);
  };

  setNotifyFn(notify);

  const gracefulShutdown = async () => {
    if (isShuttingDown) {
      console.warn("\nForce exit (second signal)");
      process.exit(1);
    }
    isShuttingDown = true;
    console.log("\nShutting down gracefully...");

    await killAllActiveProcesses();
    await mcpManager.stopAll();
    store.flush();
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

  // Register shutdown callback for HTTP-triggered graceful shutdown (Windows Tauri close)
  wsServer.shutdownCallback = () => { gracefulShutdown(); };

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
    log.info(`Crash recovery: ${recovery.runsReset} runs reset, ${recovery.tasksReset > 0 ? recovery.tasksReset : 0} tasks reset to pending`);
  }

  // Auto-cleanup runs completed more than 30 days ago
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const allRuns = store.listRuns();
  const staleRuns = allRuns.filter((r) => r.status === "completed" && r.completedAt && Date.now() - r.completedAt > MAX_AGE_MS);
  if (staleRuns.length > 0) {
    log.info(`Auto-cleanup: removing ${staleRuns.length} runs older than 30 days`);
    for (const r of staleRuns) {
      try { store.deleteRun(r.id); } catch { /* ignore */ }
    }
  }

  process.on("SIGINT", gracefulShutdown);
  // SIGTERM is not supported on Windows; the Tauri sidecar uses TerminateProcess (hard kill).
  // On Windows, we handle cleanup via HTTP /api/shutdown endpoint instead.
  if (!isWin) {
    process.on("SIGTERM", gracefulShutdown);
  }

  process.on("uncaughtException", (err) => {
    console.error("[engine] Uncaught exception — initiating shutdown:", err);
    gracefulShutdown().catch(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[engine] Unhandled rejection:", reason);
  });
}

main().catch((err) => {
  console.error("Engine failed to start:", err);
  process.exit(1);
});
