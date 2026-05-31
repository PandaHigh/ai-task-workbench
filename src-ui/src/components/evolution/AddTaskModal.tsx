import { useState, useEffect, useCallback } from "react";
import { TaskCreateForm } from "../common/TaskCreateForm";
import type { UserTaskTemplate } from "@ai-workbench/shared";

interface AddTaskModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string, priority: number, timeoutMinutes?: number) => void;
  defaultPriority?: number;
  defaultTimeout?: number;
  call?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

export function AddTaskModal({ open, onClose, onSubmit, defaultPriority = 5, defaultTimeout = 60, call }: AddTaskModalProps) {
  const [templates, setTemplates] = useState<UserTaskTemplate[]>([]);

  const loadTemplates = useCallback(async () => {
    if (!call) return;
    try {
      const list = await call("template.list", {}) as UserTaskTemplate[];
      setTemplates(list);
    } catch (err) { console.warn("[AddTaskModal] loadTemplates failed:", err instanceof Error ? err.message : err); }
  }, [call]);

  useEffect(() => {
    if (open) loadTemplates();
  }, [open, loadTemplates]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="添加任务"
      style={{
        position: "fixed", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0, 0, 0, 0.6)", backdropFilter: "blur(4px)",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-secondary)", border: "1px solid var(--border)",
          borderRadius: "12px", padding: "24px", minWidth: "min(340px, calc(100vw - 32px))", maxWidth: "480px", width: "90%",
          animation: "slideUp 0.2s ease-out",
        }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>
          添加任务
        </h3>
        <TaskCreateForm
          onSubmit={({ content, priority, timeoutMinutes }) => {
            onSubmit(content, priority, timeoutMinutes);
          }}
          onCancel={onClose}
          defaultPriority={defaultPriority}
          defaultTimeout={defaultTimeout}
          templates={templates}
          submitLabel="确认添加"
          autoFocus
        />
      </div>
    </div>
  );
}
