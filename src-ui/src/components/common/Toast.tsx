import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

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

const TOAST_STYLES: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: "rgba(63, 185, 80, 0.15)", border: "#3fb950", icon: "✓" },
  error: { bg: "rgba(248, 81, 73, 0.15)", border: "#f85149", icon: "✕" },
  warning: { bg: "rgba(210, 153, 34, 0.15)", border: "#d29922", icon: "⚠" },
  info: { bg: "rgba(88, 166, 255, 0.15)", border: "#58a6ff", icon: "ℹ" },
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: number) => void }) {
  const style = TOAST_STYLES[toast.type];

  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="toast-item"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "10px 16px",
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: "8px",
        backdropFilter: "blur(12px)",
        animation: "slideIn 0.3s ease-out",
        minWidth: "260px",
        maxWidth: "380px",
      }}
    >
      <span style={{ color: style.border, fontWeight: 700, fontSize: "14px" }}>{style.icon}</span>
      <span style={{ flex: 1, fontSize: "13px", color: "var(--text-primary)" }}>{toast.message}</span>
      <button
        onClick={() => onRemove(toast.id)}
        aria-label="关闭通知"
        style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: "14px", padding: "0 2px" }}
      >
        ✕
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(0);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = Date.now() + Math.random();
    nextIdRef.current = id;
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const success = useCallback((msg: string) => addToast("success", msg), [addToast]);
  const error = useCallback((msg: string) => addToast("error", msg), [addToast]);
  const warning = useCallback((msg: string) => addToast("warning", msg), [addToast]);
  const info = useCallback((msg: string) => addToast("info", msg), [addToast]);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
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
            <ToastItem toast={toast} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
