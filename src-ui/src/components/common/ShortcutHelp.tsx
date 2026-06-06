import { useEffect, useRef } from "react";
import { getShortcuts, setModalActive } from "../../hooks/useKeyboard";

interface ShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setModalActive(true);
      panelRef.current?.focus();
    } else {
      setModalActive(false);
    }
    return () => {
      if (open) setModalActive(false);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  if (!open) return null;

  const shortcuts = getShortcuts().filter((s) => s.priority !== 100);

  const formatKey = (s: (typeof shortcuts)[0]) => {
    const parts: string[] = [];
    if (s.mod) parts.push(navigator.platform?.includes("Mac") ? "⌘" : "Ctrl");
    parts.push(s.key === "Escape" ? "Esc" : s.key === "/" ? "/" : s.key.toUpperCase());
    return parts.join("+");
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(2px)",
        zIndex: 10001,
        animation: "fadeIn 0.15s ease-out",
      }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="快捷键帮助"
        tabIndex={-1}
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "20px 24px",
          minWidth: "300px",
          maxWidth: "400px",
          animation: "dropIn 0.2s ease-out",
          outline: "none",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "15px", color: "var(--text-primary)", fontWeight: 600 }}>快捷键</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {shortcuts.map((s, i) => (
            <div
              key={i}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}
            >
              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{s.description}</span>
              <kbd
                style={{
                  fontSize: "12px",
                  padding: "2px 8px",
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  color: "var(--text-primary)",
                  fontFamily: "monospace",
                  whiteSpace: "nowrap",
                }}
              >
                {formatKey(s)}
              </kbd>
            </div>
          ))}
        </div>
        <p style={{ margin: "16px 0 0", fontSize: "12px", color: "var(--text-secondary)", opacity: 0.7 }}>
          按 Esc 关闭
        </p>
      </div>
    </div>
  );
}
