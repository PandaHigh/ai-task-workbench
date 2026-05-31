import { useState, useEffect, useCallback } from "react";
import { useEngine } from "../../hooks/useEngine";
import { useToast } from "../common/Toast";
import type { TaskComment } from "@ai-workbench/shared";
import { formatTimestamp } from "../../lib/utils";

interface TaskCommentsProps {
  runId: string;
  taskId: string;
}

export function TaskComments({ runId, taskId }: TaskCommentsProps) {
  const { call } = useEngine();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [text, setText] = useState("");
  const toast = useToast();

  const load = useCallback(async () => {
    if (!runId) return;
    try {
      const result = (await call("comment.list", { runId, taskId })) as { comments: TaskComment[] };
      setComments(result.comments);
    } catch (err) { console.warn("[TaskComments] load failed:", err instanceof Error ? err.message : err); }
  }, [runId, taskId, call]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    try {
      await call("comment.create", {
        runId,
        taskId,
        userId: "user",
        displayName: "User",
        content: text.trim(),
      });
      setText("");
      await load();
    } catch (err) {
      toast.error(`评论失败: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div className="space-y-2">
      {comments.length > 0 && (
        <div className="max-h-40 overflow-y-auto space-y-1.5">
          {comments.map((c) => (
            <div key={c.id} className="rounded p-2 text-xs" style={{ background: "var(--bg-tertiary)" }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium" style={{ color: "var(--blue)" }}>{c.displayName}</span>
                <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{formatTimestamp(c.createdAt)}</span>
              </div>
              <p style={{ color: "var(--text-primary)" }}>{c.content}</p>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="添加评论..."
          onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) handleSubmit(); }}
          className="flex-1 rounded px-2 py-1 text-xs font-mono outline-none"
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="px-2 py-1 rounded text-xs font-mono disabled:opacity-40"
          style={{ background: "var(--blue)", color: "#fff" }}
        >
          发送
        </button>
      </div>
    </div>
  );
}
