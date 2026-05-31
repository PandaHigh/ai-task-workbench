import { describe, it, expect } from "vitest";
import { formatDuration, formatTimestamp } from "./utils";

describe("formatDuration", () => {
  it("should format milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("should format seconds", () => {
    expect(formatDuration(5000)).toBe("5s");
  });

  it("should format minutes and seconds", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("should format hours and minutes", () => {
    expect(formatDuration(3720000)).toBe("1h 2m");
  });

  it("should handle zero", () => {
    expect(formatDuration(0)).toBe("0ms");
  });

  it("should handle exactly 60 seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
  });

  it("should handle exactly 60 minutes", () => {
    expect(formatDuration(3600000)).toBe("1h 0m");
  });
});

describe("formatTimestamp", () => {
  it("should format a timestamp with month-day hour:min:sec", () => {
    const ts = new Date(2026, 4, 15, 14, 30, 45).getTime(); // May 15, 2026 14:30:45
    const result = formatTimestamp(ts);
    expect(result).toBe("05-15 14:30:45");
  });

  it("should pad single digit values", () => {
    const ts = new Date(2026, 0, 5, 3, 7, 9).getTime(); // Jan 5, 2026 03:07:09
    const result = formatTimestamp(ts);
    expect(result).toBe("01-05 03:07:09");
  });
});
