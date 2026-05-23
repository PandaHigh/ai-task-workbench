import { type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { useKeyboard } from "../../hooks/useKeyboard";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  useKeyboard();

  return (
    <div className="flex h-screen bg-[var(--bg-primary)]">
      <a
        href="#main-content"
        style={{
          position: "absolute", left: "-9999px", top: 0,
          background: "var(--blue)", color: "#fff", padding: "4px 12px",
          zIndex: 99999, fontSize: "13px",
        }}
        onFocus={(e) => (e.currentTarget.style.left = "0")}
        onBlur={(e) => (e.currentTarget.style.left = "-9999px")}
      >
        跳到主要内容
      </a>
      <Sidebar />
      <main id="main-content" className="flex-1 overflow-hidden flex flex-col" aria-live="polite">
        {children}
      </main>
    </div>
  );
}
