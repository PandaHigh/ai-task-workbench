import { useState, useEffect, useMemo, useCallback, useRef, type CSSProperties } from "react";

/**
 * Detect prefers-reduced-motion media query.
 * Returns true if the user has enabled reduced motion.
 */
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

// ---- Style helpers ----

export function pageEnterStyle(): CSSProperties {
  return { animation: "fadeIn 0.4s ease-out" };
}

/**
 * Stagger-item animation.
 * @param index  Item index in the list
 * @param baseDelay  Milliseconds between items
 * @param name  Keyframe name (default "slideUp")
 * @param duration  Animation duration in seconds (default 0.4)
 */
export function staggerItemStyle(
  index: number,
  baseDelay: number,
  name: string = "slideUp",
  duration: number = 0.4,
): CSSProperties {
  return {
    animation: `${name} ${duration}s ease-out ${index * baseDelay}ms both`,
  };
}

/** Shimmer loading placeholder. */
export function shimmerStyle(): CSSProperties {
  return {
    background: "linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-secondary) 50%, var(--bg-tertiary) 75%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s ease-in-out infinite",
  };
}

/** Typewriter effect for text reveal. */
export function typewriterStyle(duration: number = 2): CSSProperties {
  return {
    overflow: "hidden",
    whiteSpace: "nowrap" as const,
    animation: `typewriter ${duration}s steps(40) forwards`,
  };
}

/** Pulse animation for active/live indicators. */
export function pulseStyle(): CSSProperties {
  return { animation: "pulse 2s ease-in-out infinite" };
}

// ---- Hook: useAnimationStyle ----

type AnimName = "fadeIn" | "slideUp" | "slideDown" | "staggerFadeIn" | "pulse";

interface AnimOpts {
  name?: AnimName;
  duration?: number;
  delay?: number;
  /** If true, always skip animation regardless of system preference. */
  disabled?: boolean;
}

/**
 * React hook that returns a CSSProperties object for the requested animation.
 * Automatically degrades to opacity-only when `prefers-reduced-motion: reduce`
 * is active (no transforms/shimmers).
 */
export function useAnimationStyle(opts: AnimOpts = {}): CSSProperties {
  const reduced = useReducedMotion();
  const { name = "fadeIn", duration = 0.4, delay = 0, disabled = false } = opts;

  return useMemo(() => {
    if (disabled) return {};
    if (reduced) {
      // Minimal fade-only fallback — no transforms
      return { animation: `fadeIn ${duration}s ease-out ${delay}ms both` };
    }
    return { animation: `${name} ${duration}s ease-out ${delay}ms both` };
  }, [reduced, name, duration, delay, disabled]);
}

// ---- Hook: useStagger ----

/**
 * Returns a style-generator for staggered list items.
 * Respects reduced-motion by collapsing all transforms.
 */
export function useStagger(baseDelay: number = 50, name: AnimName = "slideUp", duration: number = 0.4) {
  const reduced = useReducedMotion();

  return useCallback(
    (index: number): CSSProperties => {
      if (reduced) {
        return { animation: `fadeIn ${duration}s ease-out ${index * baseDelay}ms both` };
      }
      return { animation: `${name} ${duration}s ease-out ${index * baseDelay}ms both` };
    },
    [reduced, baseDelay, name, duration],
  );
}

// ---- Hook: useTypewriter (stateful) ----

/**
 * Reveals text character-by-character.
 * Returns the currently-visible substring and a reset function.
 */
export function useTypewriter(fullText: string, speed: number = 30) {
  const [displayed, setDisplayed] = useState("");
  const idx = useRef(0);

  useEffect(() => {
    idx.current = 0;
    setDisplayed("");
    const id = setInterval(() => {
      idx.current += 1;
      if (idx.current >= fullText.length) {
        setDisplayed(fullText);
        clearInterval(id);
      } else {
        setDisplayed(fullText.slice(0, idx.current));
      }
    }, speed);
    return () => clearInterval(id);
  }, [fullText, speed]);

  const reset = useCallback(() => {
    idx.current = 0;
    setDisplayed("");
  }, []);

  return { displayed, reset };
}
