import { randomUUID } from "crypto";
import type { TraceSpan } from "@ai-workbench/shared";

export type { TraceSpan };

export class Tracer {
  private spans: Map<string, TraceSpan> = new Map();
  private notify: (method: string, params: Record<string, unknown>) => void;
  private activeTraceId: string | null = null;

  constructor(notify: (method: string, params: Record<string, unknown>) => void) {
    this.notify = notify;
  }

  /** Start a new trace (one per task execution) */
  startTrace(): string {
    this.activeTraceId = randomUUID();
    return this.activeTraceId;
  }

  /** Start a span within the current trace */
  startSpan(operation: string, parentSpanId?: string, attributes?: Record<string, unknown>): string {
    const spanId = randomUUID();
    const span: TraceSpan = {
      traceId: this.activeTraceId || randomUUID(),
      spanId,
      parentSpanId,
      operation,
      status: "running",
      startTime: Date.now(),
      attributes: attributes || {},
    };
    this.spans.set(spanId, span);
    this.notify("trace.span", { ...span, event: "start" });
    return spanId;
  }

  /** End a span */
  endSpan(spanId: string, status: "ok" | "error", attributes?: Record<string, unknown>): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    span.status = status;
    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    if (attributes) {
      span.attributes = { ...span.attributes, ...attributes };
    }
    this.notify("trace.span", { ...span, event: "end" });
  }

  /** Add attributes to a running span */
  addAttributes(spanId: string, attrs: Record<string, unknown>): void {
    const span = this.spans.get(spanId);
    if (span) {
      span.attributes = { ...span.attributes, ...attrs };
    }
  }

  /** Get all spans for current trace */
  getTrace(): TraceSpan[] {
    if (!this.activeTraceId) return [];
    return [...this.spans.values()].filter((s) => s.traceId === this.activeTraceId);
  }

  /** Get active (running) spans */
  getActiveSpans(): TraceSpan[] {
    return [...this.spans.values()].filter((s) => s.status === "running");
  }

  /** End the current trace, clean up */
  endTrace(): TraceSpan[] {
    const spans = this.getTrace();
    // End any still-running spans
    for (const span of spans) {
      if (span.status === "running") {
        this.endSpan(span.spanId, "error", { reason: "trace_ended" });
      }
    }
    this.activeTraceId = null;
    return spans;
  }

  /** Get current trace ID */
  get traceId(): string | null {
    return this.activeTraceId;
  }
}
