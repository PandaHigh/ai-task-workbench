import { useEffect, useRef, useCallback, useState } from "react";
import { engineClient } from "../lib/engine-client";

let disconnectToastShown = false;

export function useEngine() {
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const doConnect = async () => {
      try {
        await engineClient.connect();
        if (mountedRef.current) {
          setConnected(true);
          disconnectToastShown = false;
        }
      } catch (err) {
        console.warn("Engine connection failed:", err instanceof Error ? err.message : err);
        if (mountedRef.current) setConnected(false);
      }
    };
    doConnect();

    const unsub = engineClient.onNotification((method, _params) => {
      if (!mountedRef.current) return;
      if (method === "system.ready") {
        setConnected(true);
        disconnectToastShown = false;
      }
    });

    const interval = setInterval(() => {
      if (!mountedRef.current) return;
      const isConnected = engineClient.isConnected();
      setConnected((prev) => {
        if (prev && !isConnected && !disconnectToastShown) {
          disconnectToastShown = true;
          import("../components/common/Toast").then(({ useToast }) => {
            // Can't call hook outside component; use dynamic toast dispatch
          });
          // Use a custom event so any ToastProvider can pick it up
          window.dispatchEvent(new CustomEvent("engine-disconnect"));
        }
        if (!prev && isConnected) {
          disconnectToastShown = false;
          window.dispatchEvent(new CustomEvent("engine-reconnect"));
        }
        if (prev !== isConnected) return isConnected;
        return prev;
      });
    }, 2000);

    return () => {
      mountedRef.current = false;
      unsub();
      clearInterval(interval);
    };
  }, []);

  const call = useCallback(
    (method: string, params?: Record<string, unknown>, timeoutMs?: number) => {
      return engineClient.call(method, params, timeoutMs);
    },
    [],
  );

  return { connected, call };
}
