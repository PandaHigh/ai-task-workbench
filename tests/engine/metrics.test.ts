import { describe, it, expect, vi, beforeEach } from "vitest";
import { metrics } from "../../src-engine/src/lib/metrics.js";

describe("MetricsCollector", () => {
  beforeEach(() => {
    metrics.reset();
  });

  // ─── increment ────────────────────────────────────────────────────────

  describe("increment", () => {
    it("accumulates counter values, default is 1", () => {
      metrics.increment("req");
      metrics.increment("req");
      metrics.increment("req");
      expect(metrics.getCounter("req")).toBe(3);
    });

    it("accepts a custom increment value", () => {
      metrics.increment("bytes", 128);
      metrics.increment("bytes", 64);
      expect(metrics.getCounter("bytes")).toBe(192);
    });

    it("starts at 0 for unseen counter", () => {
      expect(metrics.getCounter("unknown")).toBe(0);
    });
  });

  // ─── gauge ────────────────────────────────────────────────────────────

  describe("gauge", () => {
    it("overwrites previous value", () => {
      metrics.gauge("cpu", 0.5);
      metrics.gauge("cpu", 0.8);
      expect(metrics.getGauge("cpu")).toBe(0.8);
    });

    it("returns undefined for missing gauge", () => {
      expect(metrics.getGauge("unknown")).toBeUndefined();
    });
  });

  // ─── histogram ────────────────────────────────────────────────────────

  describe("histogram", () => {
    it("appends values", () => {
      metrics.histogram("latency", 10);
      metrics.histogram("latency", 20);
      metrics.histogram("latency", 30);
      const stats = metrics.getHistogramStats("latency");
      expect(stats).not.toBeNull();
      expect(stats!.count).toBe(3);
    });

    it("caps at 1000 entries", () => {
      for (let i = 0; i < 1100; i++) {
        metrics.histogram("big", i);
      }
      const stats = metrics.getHistogramStats("big")!;
      expect(stats.count).toBe(1000);
      // The first 100 entries were shifted out, so min should be 100
      expect(stats.min).toBe(100);
    });
  });

  // ─── getHistogramStats ────────────────────────────────────────────────

  describe("getHistogramStats", () => {
    it("returns null for missing histogram", () => {
      expect(metrics.getHistogramStats("nonexistent")).toBeNull();
    });

    it("computes correct min, max, avg, p50, p95", () => {
      // Values 1..100
      for (let i = 1; i <= 100; i++) {
        metrics.histogram("vals", i);
      }
      const stats = metrics.getHistogramStats("vals")!;
      expect(stats.count).toBe(100);
      expect(stats.min).toBe(1);
      expect(stats.max).toBe(100);
      expect(stats.avg).toBeCloseTo(50.5, 1);
      // sorted: [1..100], p50 index = floor(100*0.5) = 50 -> value 51
      expect(stats.p50).toBe(51);
      // p95 index = floor(100*0.95) = 95 -> value 96
      expect(stats.p95).toBe(96);
    });

    it("handles single value", () => {
      metrics.histogram("single", 42);
      const stats = metrics.getHistogramStats("single")!;
      expect(stats.count).toBe(1);
      expect(stats.min).toBe(42);
      expect(stats.max).toBe(42);
      expect(stats.avg).toBe(42);
      expect(stats.p50).toBe(42);
      expect(stats.p95).toBe(42);
    });
  });

  // ─── getCounter / getGauge ────────────────────────────────────────────

  describe("getCounter", () => {
    it("returns 0 for missing counter", () => {
      expect(metrics.getCounter("missing")).toBe(0);
    });
  });

  describe("getGauge", () => {
    it("returns undefined for missing gauge", () => {
      expect(metrics.getGauge("missing")).toBeUndefined();
    });
  });

  // ─── log ──────────────────────────────────────────────────────────────

  describe("log", () => {
    it("appends log entries", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      metrics.log("info", "test message", { key: "val" });
      const logs = metrics.getRecentLogs(10);
      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe("info");
      expect(logs[0].message).toBe("test message");
      expect(logs[0].data).toEqual({ key: "val" });
    });

    it("caps at 1000 entries", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      for (let i = 0; i < 1100; i++) {
        metrics.log("info", `msg-${i}`);
      }
      const logs = metrics.getRecentLogs(2000);
      expect(logs.length).toBe(1000);
      // First surviving entry should be msg-100 (indices 0-99 were shifted out)
      expect(logs[0].message).toBe("msg-100");
      consoleSpy.mockRestore();
    });

    it("outputs to console.error for error level", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      metrics.log("error", "something broke");
      expect(errorSpy).toHaveBeenCalledWith("[metrics:error]", "something broke", "");
      errorSpy.mockRestore();
    });

    it("outputs to console.warn for warn level", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      metrics.log("warn", "be careful");
      expect(warnSpy).toHaveBeenCalledWith("[metrics:warn]", "be careful", "");
      warnSpy.mockRestore();
    });
  });

  // ─── snapshot ─────────────────────────────────────────────────────────

  describe("snapshot", () => {
    it("converts Maps to plain objects", () => {
      metrics.increment("reqs", 5);
      metrics.gauge("cpu", 0.75);
      metrics.histogram("lat", 10);
      metrics.histogram("lat", 20);

      const snap = metrics.snapshot();

      expect(snap.counters).toEqual({ reqs: 5 });
      expect(snap.gauges).toEqual({ cpu: 0.75 });
      expect(snap.histograms.lat).not.toBeNull();
      expect(snap.histograms.lat!.count).toBe(2);
      expect(snap.histograms.lat!.min).toBe(10);
      expect(snap.histograms.lat!.max).toBe(20);
    });

    it("returns empty objects when no data", () => {
      const snap = metrics.snapshot();
      expect(snap.counters).toEqual({});
      expect(snap.gauges).toEqual({});
      expect(snap.histograms).toEqual({});
    });
  });

  // ─── reset ────────────────────────────────────────────────────────────

  describe("reset", () => {
    it("clears all state", () => {
      vi.spyOn(console, "log").mockImplementation(() => {});

      metrics.increment("a");
      metrics.gauge("b", 1);
      metrics.histogram("c", 1);
      metrics.log("info", "msg");

      metrics.reset();

      expect(metrics.getCounter("a")).toBe(0);
      expect(metrics.getGauge("b")).toBeUndefined();
      expect(metrics.getHistogramStats("c")).toBeNull();
      expect(metrics.getRecentLogs(100)).toHaveLength(0);
    });
  });
});
