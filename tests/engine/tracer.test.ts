import { describe, it, expect, vi, beforeEach } from "vitest";
import { Tracer } from "../../src-engine/src/lib/tracer.js";

describe("Tracer", () => {
  let tracer: Tracer;
  let notifications: Array<{ method: string; params: Record<string, unknown> }>;

  beforeEach(() => {
    notifications = [];
    tracer = new Tracer((method, params) => {
      notifications.push({ method, params });
    });
  });

  it("should start a trace and return traceId", () => {
    const traceId = tracer.startTrace();
    expect(traceId).toBeTruthy();
    expect(typeof traceId).toBe("string");
    expect(tracer.traceId).toBe(traceId);
  });

  it("should start a span with correct defaults", () => {
    tracer.startTrace();
    const spanId = tracer.startSpan("agent.execute");

    expect(spanId).toBeTruthy();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].method).toBe("trace.span");

    const params = notifications[0].params;
    expect(params.operation).toBe("agent.execute");
    expect(params.status).toBe("running");
    expect(params.traceId).toBeTruthy();
    expect(params.spanId).toBe(spanId);
    expect(params.startTime).toBeGreaterThan(0);
  });

  it("should start a span with parent and attributes", () => {
    tracer.startTrace();
    const parentSpanId = tracer.startSpan("crew.run");
    const childSpanId = tracer.startSpan("agent.execute", parentSpanId, { role: "developer" });

    const childNotif = notifications.find((n) => n.params.spanId === childSpanId);
    expect(childNotif?.params.parentSpanId).toBe(parentSpanId);
    expect((childNotif?.params.attributes as Record<string, unknown>).role).toBe("developer");
  });

  it("should end a span with ok status", () => {
    tracer.startTrace();
    const spanId = tracer.startSpan("test.op");
    notifications.length = 0;

    tracer.endSpan(spanId, "ok", { cost: 0.5 });

    expect(notifications).toHaveLength(1);
    const params = notifications[0].params;
    expect(params.status).toBe("ok");
    expect(params.endTime).toBeGreaterThan(0);
    expect(params.durationMs).toBeGreaterThanOrEqual(0);
    expect((params.attributes as Record<string, unknown>).cost).toBe(0.5);
  });

  it("should end a span with error status", () => {
    tracer.startTrace();
    const spanId = tracer.startSpan("test.op");
    tracer.endSpan(spanId, "error", { error: "timeout" });

    const params = notifications.find((n) => n.params.event === "end")?.params;
    expect(params?.status).toBe("error");
  });

  it("should ignore endSpan for unknown spanId", () => {
    tracer.startTrace();
    expect(() => tracer.endSpan("nonexistent", "ok")).not.toThrow();
  });

  it("should add attributes to a running span", () => {
    tracer.startTrace();
    const spanId = tracer.startSpan("test.op");
    tracer.addAttributes(spanId, { files: ["a.ts", "b.ts"] });

    const spans = tracer.getTrace();
    const span = spans.find((s) => s.spanId === spanId);
    expect((span?.attributes as Record<string, unknown>).files).toEqual(["a.ts", "b.ts"]);
  });

  it("should return all spans for current trace via getTrace()", () => {
    tracer.startTrace();
    tracer.startSpan("op1");
    tracer.startSpan("op2");
    tracer.startSpan("op3");

    const spans = tracer.getTrace();
    expect(spans).toHaveLength(3);
  });

  it("should return empty array for getTrace() when no active trace", () => {
    expect(tracer.getTrace()).toEqual([]);
  });

  it("should return active (running) spans via getActiveSpans()", () => {
    tracer.startTrace();
    const id1 = tracer.startSpan("op1");
    const id2 = tracer.startSpan("op2");
    tracer.endSpan(id1, "ok");

    const active = tracer.getActiveSpans();
    expect(active).toHaveLength(1);
    expect(active[0].spanId).toBe(id2);
  });

  it("should end all running spans on endTrace()", () => {
    tracer.startTrace();
    tracer.startSpan("op1");
    tracer.startSpan("op2");

    const spans = tracer.endTrace();
    expect(spans).toHaveLength(2);
    expect(spans.every((s) => s.status !== "running")).toBe(true);
    expect(tracer.traceId).toBeNull();
  });

  it("should emit trace.span notifications for each span event", () => {
    tracer.startTrace();
    const spanId = tracer.startSpan("test");
    tracer.endSpan(spanId, "ok");

    const spanNotifs = notifications.filter((n) => n.method === "trace.span");
    expect(spanNotifs).toHaveLength(2); // start + end

    const startEvent = spanNotifs.find((n) => (n.params as Record<string, unknown>).event === "start");
    const endEvent = spanNotifs.find((n) => (n.params as Record<string, unknown>).event === "end");
    expect(startEvent).toBeTruthy();
    expect(endEvent).toBeTruthy();
  });
});
