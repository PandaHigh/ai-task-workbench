import { useState, useEffect, useCallback } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "pandaai-theme";

function getInitial(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitial);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    const html = document.documentElement;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      html.classList.add("theme-transitioning");
    }
    setThemeState((t) => (t === "light" ? "dark" : "light"));
    setTimeout(() => html.classList.remove("theme-transitioning"), 350);
  }, []);

  return { theme, toggle };
}
