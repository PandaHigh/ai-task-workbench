import { useToastStore } from "../hooks/useToast";
import type { ToastType } from "../hooks/useToast";

const icons: Record<ToastType, string> = {
  success: "✓",
  error: "✗",
  info: "ℹ",
};

const colors: Record<ToastType, { bg: string; border: string; text: string }> = {
  success: { bg: "rgba(63, 185, 80, 0.12)", border: "var(--green)", text: "var(--green)" },
  error: { bg: "rgba(248, 81, 73, 0.12)", border: "var(--red)", text: "var(--red)" },
  info: { bg: "rgba(88, 166, 255, 0.12)", border: "var(--blue)", text: "var(--blue)" },
};

export function Toast() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => {
        const c = colors[t.type];
        return (
          <div
            key={t.id}
            onClick={() => removeToast(t.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 6,
              color: "var(--text-primary)",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              pointerEvents: "auto",
              animation: "slideIn 0.3s ease-out forwards",
              minWidth: 240,
              maxWidth: 400,
            }}
          >
            <span style={{ color: c.text, fontWeight: 700, fontSize: 14 }}>
              {icons[t.type]}
            </span>
            <span style={{ flex: 1 }}>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
