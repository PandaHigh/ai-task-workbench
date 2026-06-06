import { useState, useCallback, useRef } from "react";
import { useToast } from "../components/common/Toast";

export function useAsyncAction() {
  const [loading, setLoading] = useState<string | null>(null);
  const toast = useToast();
  const loadingRef = useRef<string | null>(null);

  const execute = useCallback(
    async <T>(
      key: string,
      fn: () => Promise<T>,
      onSuccess?: (result: T) => void,
      errorMessage?: string,
    ): Promise<T | undefined> => {
      if (loadingRef.current) return undefined;
      loadingRef.current = key;
      setLoading(key);
      try {
        const result = await fn();
        onSuccess?.(result);
        return result;
      } catch (err) {
        toast.error(errorMessage || `操作出错了: ${err instanceof Error ? err.message : err}`);
        return undefined;
      } finally {
        loadingRef.current = null;
        setLoading(null);
      }
    },
    [toast],
  );

  return { loading, execute };
}
