import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LogSearchBar } from "./LogSearchBar";

const logs = [
  { id: 1, timestamp: Date.now() - 3000, level: "info", source: "engine", message: "Started" },
  { id: 2, timestamp: Date.now() - 2000, level: "error", source: "cc", message: "CC failed" },
  { id: 3, timestamp: Date.now() - 1000, level: "warn", source: "git", message: "Conflict detected" },
  { id: 4, timestamp: Date.now(), level: "info", source: "scorer", message: "Score: 0.8" },
];

describe("LogSearchBar", () => {
  it("should call onFilteredChange with all logs initially", () => {
    const onFilteredChange = vi.fn();
    render(<LogSearchBar logs={logs} onFilteredChange={onFilteredChange} />);
    expect(onFilteredChange).toHaveBeenCalledWith(logs);
  });

  it("should filter by search text", () => {
    const onFilteredChange = vi.fn();
    render(<LogSearchBar logs={logs} onFilteredChange={onFilteredChange} />);
    onFilteredChange.mockClear();
    fireEvent.change(screen.getByLabelText("搜索日志"), { target: { value: "conflict" } });
    expect(onFilteredChange).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ message: "Conflict detected" })]),
    );
  });

  it("should filter by level", () => {
    const onFilteredChange = vi.fn();
    render(<LogSearchBar logs={logs} onFilteredChange={onFilteredChange} />);
    onFilteredChange.mockClear();
    fireEvent.change(screen.getByLabelText("日志级别过滤"), { target: { value: "error" } });
    expect(onFilteredChange).toHaveBeenCalledWith([logs[1]]);
  });

  it("should filter by source", () => {
    const onFilteredChange = vi.fn();
    render(<LogSearchBar logs={logs} onFilteredChange={onFilteredChange} />);
    onFilteredChange.mockClear();
    fireEvent.change(screen.getByLabelText("日志来源过滤"), { target: { value: "git" } });
    expect(onFilteredChange).toHaveBeenCalledWith([logs[2]]);
  });

  it("should show filter count when filtering", () => {
    render(<LogSearchBar logs={logs} onFilteredChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("日志级别过滤"), { target: { value: "error" } });
    expect(screen.getByText("1/4")).toBeInTheDocument();
  });

  it("should clear all filters", () => {
    const onFilteredChange = vi.fn();
    render(<LogSearchBar logs={logs} onFilteredChange={onFilteredChange} />);
    fireEvent.change(screen.getByLabelText("搜索日志"), { target: { value: "test" } });
    onFilteredChange.mockClear();
    fireEvent.click(screen.getByText("清除"));
    expect(onFilteredChange).toHaveBeenCalledWith(logs);
  });

  it("should not show filter count when no filter is active", () => {
    render(<LogSearchBar logs={logs} onFilteredChange={vi.fn()} />);
    expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
  });

  it("should show clear button only when filter is active", () => {
    render(<LogSearchBar logs={logs} onFilteredChange={vi.fn()} />);
    expect(screen.queryByText("清除")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索日志"), { target: { value: "test" } });
    expect(screen.getByText("清除")).toBeInTheDocument();
  });
});
