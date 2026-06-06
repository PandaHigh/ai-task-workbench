import { useState, useMemo, useEffect } from "react";

interface LogEntry {
  id: number;
  timestamp: number;
  level: string;
  source: string;
  message: string;
}

interface LogSearchBarProps {
  logs: LogEntry[];
  onFilteredChange: (filtered: LogEntry[]) => void;
}

const LEVEL_OPTIONS = ["all", "error", "warn", "info"] as const;
const SOURCE_OPTIONS = ["all", "engine", "cc", "git", "scorer"] as const;

export function LogSearchBar({ logs, onFilteredChange }: LogSearchBarProps) {
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    let result = logs;
    if (levelFilter !== "all") {
      result = result.filter((l) => l.level === levelFilter);
    }
    if (sourceFilter !== "all") {
      result = result.filter((l) => l.source === sourceFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((l) => l.message.toLowerCase().includes(q) || l.source.toLowerCase().includes(q));
    }
    return result;
  }, [logs, search, levelFilter, sourceFilter]);

  // Notify parent of filtered results
  useEffect(() => {
    onFilteredChange(filtered);
  }, [filtered, onFilteredChange]);

  const hasFilter = search || levelFilter !== "all" || sourceFilter !== "all";

  return (
    <div className="flex items-center gap-2 mb-2 flex-wrap">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索日志..."
        className="text-xs px-2 py-1 rounded"
        style={{
          background: "var(--bg-primary)",
          color: "var(--text-primary)",
          border: "1px solid var(--border)",
          outline: "none",
          width: "clamp(120px, 30vw, 200px)",
        }}
        aria-label="搜索日志"
      />
      <select
        value={levelFilter}
        onChange={(e) => setLevelFilter(e.target.value)}
        className="text-xs px-2 py-1 rounded"
        style={{
          background: "var(--bg-primary)",
          color: "var(--text-primary)",
          border: "1px solid var(--border)",
          outline: "none",
        }}
        aria-label="日志级别过滤"
      >
        {LEVEL_OPTIONS.map((l) => (
          <option key={l} value={l}>
            {l === "all" ? "全部级别" : l.toUpperCase()}
          </option>
        ))}
      </select>
      <select
        value={sourceFilter}
        onChange={(e) => setSourceFilter(e.target.value)}
        className="text-xs px-2 py-1 rounded"
        style={{
          background: "var(--bg-primary)",
          color: "var(--text-primary)",
          border: "1px solid var(--border)",
          outline: "none",
        }}
        aria-label="日志来源过滤"
      >
        {SOURCE_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s === "all" ? "全部来源" : s}
          </option>
        ))}
      </select>
      {hasFilter && (
        <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
          {filtered.length}/{logs.length}
        </span>
      )}
      {hasFilter && (
        <button
          onClick={() => {
            setSearch("");
            setLevelFilter("all");
            setSourceFilter("all");
          }}
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{
            color: "var(--text-secondary)",
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
          }}
        >
          清除
        </button>
      )}
    </div>
  );
}
