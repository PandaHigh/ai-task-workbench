import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextType {
  addToast: (type: ToastType, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextType>({
  addToast: () => {},
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

const TOAST_STYLES: Record<ToastType, { border: string; icon: string }> = {
  success: { border: "var(--green)", icon: "✓" },
  error: { border: "var(--red)", icon: "✕" },
  warning: { border: "var(--yellow)", icon: "⚠" },
  info: { border: "var(--blue)", icon: "ℹ" },
};

function ToastItem({ toast, exiting, onRemove }: { toast: Toast; exiting: boolean; onRemove: (id: number) => void }) {
  const style = TOAST_STYLES[toast.type];

  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 16px",
        background: "var(--bg-elevated)",
        border: `1px solid ${style.border}`,
        borderLeft: `3px solid ${style.border}`,
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-lg)",
        animation: exiting ? "none" : "slideIn 0.3s ease-out",
        transition: "opacity 0.2s ease, transform 0.2s ease",
        opacity: exiting ? 0 : 1,
        transform: exiting ? "translateX(100%)" : "translateX(0)",
        minWidth: "260px",
        maxWidth: "380px",
      }}
    >
      <span style={{ color: style.border, fontWeight: 700, fontSize: "13px" }}>{style.icon}</span>
      <span style={{ flex: 1, fontSize: "13px", color: "var(--text-primary)" }}>{toast.message}</span>
      <button
        onClick={() => onRemove(toast.id)}
        aria-label="关闭通知"
        style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "14px", padding: "0 2px" }}
      >
        {"✕"}
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [exitingIds, setExitingIds] = useState<Set<number>>(new Set());

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const success = useCallback((msg: string) => addToast("success", msg), [addToast]);
  const error = useCallback((msg: string) => addToast("error", msg), [addToast]);
  const warning = useCallback((msg: string) => addToast("warning", msg), [addToast]);
  const info = useCallback((msg: string) => addToast("info", msg), [addToast]);

  const removeToast = useCallback((id: number) => {
    setExitingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      setExitingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, success, error, warning, info }}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          display: "flex",
          flexDirection: "column-reverse",
          gap: "8px",
          zIndex: 9999,
          pointerEvents: "none",
        }}
      >
        {toasts.map((toast) => (
          <div key={toast.id} style={{ pointerEvents: "auto" }}>
            <ToastItem toast={toast} exiting={exitingIds.has(toast.id)} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
