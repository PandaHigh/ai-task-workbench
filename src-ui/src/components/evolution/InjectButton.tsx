import { useState } from "react";
import { engineClient } from "../../lib/engine-client";
import { useToast } from "../common/Toast";

interface InjectButtonProps {
  runId: string;
  disabled?: boolean;
}

export function InjectButton({ runId, disabled }: InjectButtonProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const toast = useToast();

  const handleInject = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      await engineClient.call("approval.inject", {
        runId,
        instructions: text.trim(),
      });
      setText("");
      setSent(true);
      setTimeout(() => setSent(false), 2000);
      toast.success("指令已注入，将在下一个任务中生效");
    } catch (err) {
      toast.error(`注入失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="w-full text-left px-3 py-1.5 text-xs font-mono text-gray-400 hover:text-gray-200 hover:bg-white/5 rounded transition-colors disabled:opacity-30"
      >
        注入指令
      </button>
      {sent ? (
        <div className="mt-1 px-2 py-1 text-xs font-mono rounded" style={{ color: "var(--green)" }}>
          指令已注入
        </div>
      ) : open && (
        <div className="mt-1 space-y-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入要注入的指令..."
            rows={3}
            className="w-full bg-black/40 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 resize-none"
          />
          <button
            onClick={handleInject}
            disabled={loading || !text.trim()}
            className="w-full px-2 py-1 bg-blue-600/60 hover:bg-blue-600 text-blue-100 text-xs font-mono rounded transition-colors disabled:opacity-40"
          >
            {loading ? "发送中..." : "发送"}
          </button>
        </div>
      )}
    </div>
  );
}
