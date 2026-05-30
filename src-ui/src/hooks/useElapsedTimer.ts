import { useState, useEffect, useRef } from "react";

export function useElapsedTimer(startTimestamp: number | null | undefined, intervalMs = 1000): string {
  const [elapsed, setElapsed] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!startTimestamp) {
      setElapsed("");
      return;
    }

    const update = () => {
      const ms = Date.now() - startTimestamp;
      const s = Math.floor(ms / 1000);
      if (s < 60) setElapsed(`${s}s`);
      else if (s < 3600) setElapsed(`${Math.floor(s / 60)}m ${s % 60}s`);
      else setElapsed(`${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
    };

    update();
    timerRef.current = setInterval(update, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startTimestamp, intervalMs]);

  return elapsed;
}
