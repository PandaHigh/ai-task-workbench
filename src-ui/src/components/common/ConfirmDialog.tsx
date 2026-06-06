import { useEffect, useRef, useCallback, useState } from "react";
import { setModalActive, useRegisterShortcut } from "../../hooks/useKeyboard";

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title = "确认",
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  const titleId = "dialog-title";
  const descId = "dialog-desc";

  useRegisterShortcut({
    key: "Escape",
    description: "关闭对话框",
    action: onCancel,
    priority: 100,
  });

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setModalActive(true);
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
          const firstBtn = dialogRef.current?.querySelector<HTMLElement>("button");
          firstBtn?.focus();
        });
      });
    } else if (mounted) {
      setVisible(false);
      setModalActive(false);
    }

    return () => {
      if (open) setModalActive(false);
    };
  }, [open]);

  const handleTransitionEnd = useCallback(() => {
    if (!visible && mounted) {
      setMounted(false);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }
  }, [visible, mounted]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onCancel],
  );

  if (!mounted) return null;

  const confirmColor = variant === "danger" ? "var(--red)" : "var(--blue)";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 10000,
        opacity: visible ? 1 : 0,
        transition: "opacity 0.15s ease-out",
      }}
      onClick={onCancel}
      onKeyDown={handleKeyDown}
      onTransitionEnd={handleTransitionEnd}
    >
      <div
        ref={dialogRef}
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "24px",
          minWidth: "280px",
          maxWidth: "min(420px, calc(100vw - 32px))",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0) scale(1)" : "translateY(-20px) scale(0.95)",
          transition: "opacity 0.2s ease-out, transform 0.2s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} style={{ margin: "0 0 12px", fontSize: "16px", color: "var(--text-primary)" }}>
          {title}
        </h3>
        <p
          id={descId}
          style={{ margin: "0 0 20px", fontSize: "14px", color: "var(--text-secondary)", lineHeight: 1.5 }}
        >
          {message}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button
            onClick={onCancel}
            aria-label={cancelLabel}
            style={{
              padding: "6px 16px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            aria-label={confirmLabel}
            style={{
              padding: "6px 16px",
              background: confirmColor,
              border: "none",
              borderRadius: "6px",
              color: "#fff",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
