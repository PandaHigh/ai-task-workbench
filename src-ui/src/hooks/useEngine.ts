import { useEffect, useRef, useCallback, useState } from "react";
import { engineClient } from "../lib/engine-client";

export function useEngine() {
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const doConnect = async () => {
      try {
        await engineClient.connect();
        if (mountedRef.current) setConnected(true);
      } catch {
        if (mountedRef.current) setConnected(false);
      }
    };
    doConnect();

    const unsub = engineClient.onNotification((method, _params) => {
      if (!mountedRef.current) return;
      if (method === "system.ready") {
        setConnected(true);
      }
    });

    // Poll connection state to detect disconnects
    const interval = setInterval(() => {
      if (!mountedRef.current) return;
      const isConnected = engineClient.isConnected();
      setConnected((prev) => {
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
    (method: string, params?: Record<string, unknown>) => {
      return engineClient.call(method, params);
    },
    [],
  );

  return { connected, call };
}
