import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export function useKeyboard() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + N → new task wizard
      if (mod && e.key === "n") {
        e.preventDefault();
        navigate("/wizard");
      }

      // Escape → go back
      if (e.key === "Escape") {
        // Only if not in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          navigate(-1);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);
}
