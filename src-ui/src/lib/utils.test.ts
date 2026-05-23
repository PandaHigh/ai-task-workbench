import { describe, it, expect } from "vitest";
import { formatDuration, formatTimestamp, formatCost } from "./utils";

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(59000)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(65000)).toBe("1m 5s");
    expect(formatDuration(3599000)).toBe("59m 59s");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3600000)).toBe("1h 0m");
    expect(formatDuration(3660000)).toBe("1h 1m");
    expect(formatDuration(7200000)).toBe("2h 0m");
  });
});

describe("formatTimestamp", () => {
  it("formats timestamp to MM-DD HH:MM:SS", () => {
    const ts = new Date(2024, 0, 15, 9, 30, 45).getTime();
    const result = formatTimestamp(ts);
    expect(result).toBe("01-15 09:30:45");
  });

  it("pads single-digit values", () => {
    const ts = new Date(2024, 5, 5, 5, 5, 5).getTime();
    const result = formatTimestamp(ts);
    expect(result).toBe("06-05 05:05:05");
  });
});

describe("formatCost", () => {
  it("formats small costs with 4 decimals", () => {
    expect(formatCost(0.001)).toBe("$0.0010");
    expect(formatCost(0.009)).toBe("$0.0090");
  });

  it("formats larger costs with 2 decimals", () => {
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(123.456)).toBe("$123.46");
  });
});
