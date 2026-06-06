import { type ReactNode, useState, useCallback, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { useKeyboard, setToggleHelp } from "../../hooks/useKeyboard";
import { useTheme } from "../../hooks/useTheme";
import { useToast } from "../common/Toast";
import { ShortcutHelp } from "../common/ShortcutHelp";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [showHelp, setShowHelp] = useState(false);
  useKeyboard();
  useTheme();
  const toast = useToast();

  useEffect(() => {
    const onDisconnect = () => toast.warning("引擎连接断开，正在尝试重连...");
    const onReconnect = () => toast.success("引擎已重新连接");
    window.addEventListener("engine-disconnect", onDisconnect);
    window.addEventListener("engine-reconnect", onReconnect);
    return () => {
      window.removeEventListener("engine-disconnect", onDisconnect);
      window.removeEventListener("engine-reconnect", onReconnect);
    };
  }, [toast]);

  const toggleHelpPanel = useCallback(() => setShowHelp((v) => !v), []);
  setToggleHelp(toggleHelpPanel);

  return (
    <div className="flex h-screen bg-[var(--bg-primary)]">
      <a
        href="#main-content"
        style={{
          position: "absolute",
          left: "-9999px",
          top: 0,
          background: "var(--blue)",
          color: "#fff",
          padding: "4px 12px",
          zIndex: 99999,
          fontSize: "13px",
        }}
        onFocus={(e) => (e.currentTarget.style.left = "0")}
        onBlur={(e) => (e.currentTarget.style.left = "-9999px")}
      >
        跳到主要内容
      </a>
      <Sidebar />
      <main id="main-content" className="flex-1 overflow-hidden flex flex-col max-md:pl-12" aria-live="polite">
        {children}
      </main>
      <ShortcutHelp open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
