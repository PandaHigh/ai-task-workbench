import { useState, useCallback } from "react";
import { isTauri } from "../lib/platform";

export function useDesktopEngine() {
  const [restarting, setRestarting] = useState(false);

  const restartEngine = useCallback(async () => {
    if (!isTauri) return false;
    setRestarting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("restart_engine");
      return true;
    } catch (err) {
      console.error("[desktop-engine] restart failed:", err);
      return false;
    } finally {
      setRestarting(false);
    }
  }, []);

  const getEngineStatus = useCallback(async () => {
    if (!isTauri) return null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return (await invoke("engine_status")) as boolean;
    } catch {
      return null;
    }
  }, []);

  return { isDesktop: isTauri, restarting, restartEngine, getEngineStatus };
}
