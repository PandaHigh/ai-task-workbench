import { useRef, useEffect, type ReactNode } from "react";

interface TerminalProps {
  children: ReactNode;
  className?: string;
}

export function Terminal({ children, className = "" }: TerminalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  });

  return (
    <div
      ref={ref}
      className={`font-mono text-xs leading-relaxed overflow-y-auto ${className}`}
      style={{ background: "#010409", padding: "16px" }}
    >
      {children}
    </div>
  );
}

interface TerminalLineProps {
  content: string;
  color?: string;
  prefix?: string;
}

export function TerminalLine({ content, color, prefix }: TerminalLineProps) {
  return (
    <div className="terminal-line">
      {prefix && (
        <span style={{ color: "var(--green)" }}>{prefix}</span>
      )}
      <span style={{ color: color || "var(--text-primary)" }}>
        {content}
      </span>
    </div>
  );
}
