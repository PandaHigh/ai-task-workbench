import { useState, useEffect, useMemo, useCallback, useRef, type CSSProperties } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

export function pageEnterStyle(): CSSProperties {
  return { animation: "fadeIn 0.4s ease-out" };
}

export function staggerItemStyle(index: number, baseDelay: number, name = "slideUp", duration = 0.4): CSSProperties {
  return { animation: `${name} ${duration}s ease-out ${index * baseDelay}ms both` };
}

export function shimmerStyle(): CSSProperties {
  return {
    background: "linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-secondary) 50%, var(--bg-tertiary) 75%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s ease-in-out infinite",
  };
}

type AnimName = "fadeIn" | "slideUp" | "slideDown" | "staggerFadeIn" | "pulse";

export function useAnimationStyle(opts: { name?: AnimName; duration?: number; delay?: number; disabled?: boolean } = {}): CSSProperties {
  const reduced = useReducedMotion();
  const { name = "fadeIn", duration = 0.4, delay = 0, disabled = false } = opts;
  return useMemo(() => {
    if (disabled) return {};
    if (reduced) return { animation: `fadeIn ${duration}s ease-out ${delay}ms both` };
    return { animation: `${name} ${duration}s ease-out ${delay}ms both` };
  }, [reduced, name, duration, delay, disabled]);
}

export function useStagger(baseDelay = 50, name: AnimName = "slideUp", duration = 0.4) {
  const reduced = useReducedMotion();
  return useCallback(
    (index: number): CSSProperties => {
      if (reduced) return { animation: `fadeIn ${duration}s ease-out ${index * baseDelay}ms both` };
      return { animation: `${name} ${duration}s ease-out ${index * baseDelay}ms both` };
    },
    [reduced, baseDelay, name, duration],
  );
}

export function useTypewriter(fullText: string, speed = 30) {
  const [displayed, setDisplayed] = useState("");
  const idx = useRef(0);
  useEffect(() => {
    idx.current = 0;
    setDisplayed("");
    const id = setInterval(() => {
      idx.current += 1;
      if (idx.current >= fullText.length) { setDisplayed(fullText); clearInterval(id); }
      else setDisplayed(fullText.slice(0, idx.current));
    }, speed);
    return () => clearInterval(id);
  }, [fullText, speed]);
  const reset = useCallback(() => { idx.current = 0; setDisplayed(""); }, []);
  return { displayed, reset };
}
