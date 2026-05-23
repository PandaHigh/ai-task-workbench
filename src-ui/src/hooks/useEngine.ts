import { useEffect, useRef, useCallback, useState } from "react";
import { engineClient } from "../lib/engine-client";

export function useEngine() {
  const [connected, setConnected] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    engineClient.connect().then(() => {
      if (mountedRef.current) setConnected(true);
    }).catch(() => {
      if (mountedRef.current) setConnected(false);
    });

    const unsub = engineClient.onNotification((method, _params) => {
      if (method === "system.ready" && mountedRef.current) {
        setConnected(true);
      }
    });

    return () => {
      mountedRef.current = false;
      unsub();
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
