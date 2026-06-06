import { useRef, useEffect, useState, useCallback, type ReactNode } from "react";

const MAX_VISIBLE_LINES = 500;

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
      role="log"
      aria-live="polite"
      aria-label="终端输出"
      className={`font-mono text-xs leading-relaxed overflow-y-auto ${className}`}
      style={{ background: "var(--bg-tertiary)", padding: "16px" }}
    >
      {children}
    </div>
  );
}

const ANSI_COLORS: Record<number, string> = {
  30: "#1b1f24",
  31: "var(--red)",
  32: "var(--green)",
  33: "var(--yellow)",
  34: "var(--blue)",
  35: "var(--purple)",
  36: "#39c5cf",
  37: "var(--text-primary)",
  90: "var(--text-secondary)",
  91: "#ff7b72",
  92: "var(--green)",
  93: "var(--yellow)",
  94: "var(--blue)",
  95: "var(--purple)",
  96: "#39c5cf",
  97: "var(--text-primary)",
};

function parseAnsi(text: string): { text: string; color?: string }[] {
  const parts: { text: string; color?: string }[] = [];
  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentColor: string | undefined;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), color: currentColor });
    }
    const codes = match[1].split(";").map(Number);
    if (codes.length === 1 && codes[0] === 0) {
      currentColor = undefined;
    } else if (codes.length === 2 && codes[0] === 1) {
      currentColor = ANSI_COLORS[codes[1]] ?? currentColor;
    } else if (codes.length >= 1) {
      currentColor = ANSI_COLORS[codes[codes.length - 1]] ?? currentColor;
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), color: currentColor });
  }

  return parts.length > 0 ? parts : [{ text, color: undefined }];
}

interface TerminalLineProps {
  content: string;
  color?: string;
  prefix?: string;
}

export function TerminalLine({ content, color, prefix }: TerminalLineProps) {
  const hasAnsi = content.includes("\x1b[");

  if (!hasAnsi) {
    return (
      <div className="terminal-line terminal-line-enter">
        {prefix && <span style={{ color: "var(--green)" }}>{prefix}</span>}
        <span style={{ color: color || "var(--text-primary)" }}>{content}</span>
      </div>
    );
  }

  const parts = parseAnsi(content);
  return (
    <div className="terminal-line terminal-line-enter">
      {prefix && <span style={{ color: "var(--green)" }}>{prefix}</span>}
      {parts.map((part, i) => (
        <span key={i} style={{ color: part.color || color || "var(--text-primary)" }}>
          {part.text}
        </span>
      ))}
    </div>
  );
}

interface VirtualizedTerminalProps {
  lines: string[];
  className?: string;
}

export function VirtualizedTerminal({ lines, className = "" }: VirtualizedTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: MAX_VISIBLE_LINES });

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const lineH = 21; // approx line-height
    const startLine = Math.max(0, Math.floor(el.scrollTop / lineH) - 50);
    const endLine = Math.min(lines.length, startLine + MAX_VISIBLE_LINES + 100);
    setVisibleRange({ start: startLine, end: endLine });
  }, [lines.length]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines.length]);

  const visibleLines = lines.slice(visibleRange.start, visibleRange.end);
  const lineH = 21;

  return (
    <div
      ref={containerRef}
      role="log"
      aria-live="polite"
      aria-label="终端输出"
      className={`font-mono text-xs leading-relaxed overflow-y-auto ${className}`}
      style={{ background: "var(--bg-tertiary)", padding: "16px" }}
      onScroll={handleScroll}
    >
      <div style={{ height: lines.length * lineH, position: "relative" }}>
        <div style={{ position: "absolute", top: visibleRange.start * lineH, left: 0, right: 0 }}>
          {visibleLines.map((line, i) => (
            <TerminalLine key={visibleRange.start + i} content={line} />
          ))}
        </div>
      </div>
    </div>
  );
}
