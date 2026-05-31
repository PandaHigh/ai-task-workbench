type MetricType = "counter" | "gauge" | "histogram";

interface MetricEntry {
  name: string;
  type: MetricType;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

export type { MetricEntry };

class MetricsCollector {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private logs: Array<{ level: string; message: string; timestamp: number; data?: unknown }> = [];

  increment(name: string, value = 1, tags?: Record<string, string>): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
    if (tags) this.log("metric", `${name} += ${value}`, { name, type: "counter" as const, value, tags });
  }

  gauge(name: string, value: number, tags?: Record<string, string>): void {
    this.gauges.set(name, value);
    if (tags) this.log("metric", `${name} = ${value}`, { name, type: "gauge" as const, value, tags });
  }

  histogram(name: string, value: number, _tags?: Record<string, string>): void {
    const arr = this.histograms.get(name) ?? [];
    arr.push(value);
    if (arr.length > 1000) arr.shift();
    this.histograms.set(name, arr);
  }

  log(level: string, message: string, data?: unknown): void {
    const entry = { level, message, timestamp: Date.now(), data };
    this.logs.push(entry);
    if (this.logs.length > 1000) this.logs.shift();

    // Also output to console with structured format
    const prefix = `[metrics:${level}]`;
    if (level === "error") {
      console.error(prefix, message, data ?? "");
    } else if (level === "warn") {
      console.warn(prefix, message, data ?? "");
    } else {
      console.log(prefix, message, data ?? "");
    }
  }

  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  getGauge(name: string): number | undefined {
    return this.gauges.get(name);
  }

  getHistogramStats(name: string): { count: number; min: number; max: number; avg: number; p50: number; p95: number } | null {
    const arr = this.histograms.get(name);
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sorted.reduce((s, v) => s + v, 0) / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
    };
  }

  getRecentLogs(count = 100): typeof this.logs {
    return this.logs.slice(-count);
  }

  /** Return a snapshot of all metrics */
  snapshot(): { counters: Record<string, number>; gauges: Record<string, number>; histograms: Record<string, ReturnType<MetricsCollector["getHistogramStats"]>> } {
    const h: Record<string, ReturnType<MetricsCollector["getHistogramStats"]>> = {};
    for (const name of this.histograms.keys()) {
      h[name] = this.getHistogramStats(name);
    }
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: h,
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.logs = [];
  }
}

export const metrics = new MetricsCollector();
export type { MetricsCollector };
