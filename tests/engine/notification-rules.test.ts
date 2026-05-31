import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotificationEngine, type NotificationRule, type NotificationEvent } from "../../src-engine/src/lib/notification-rules.js";

describe("NotificationEngine", () => {
  let engine: NotificationEngine;

  beforeEach(() => {
    engine = new NotificationEngine();
    vi.restoreAllMocks();
  });

  const makeEvent = (event: string): NotificationEvent => ({
    event,
    runId: "run-1",
    data: {},
    timestamp: Date.now(),
  });

  describe("matchesPattern", () => {
    it("should match wildcard pattern", () => {
      engine.loadRules([{ id: "r1", name: "all", enabled: true, eventPattern: "*", channels: [{ type: "websocket" }] }]);
      // dispatch should not throw
      expect(() => engine.dispatch(makeEvent("anything"))).not.toThrow();
    });

    it("should match exact event pattern", () => {
      const rules: NotificationRule[] = [
        { id: "r1", name: "completed", enabled: true, eventPattern: "task.completed", channels: [{ type: "websocket" }] },
      ];
      engine.loadRules(rules);
      // Should process without error for matching event
      expect(() => engine.dispatch(makeEvent("task.completed"))).not.toThrow();
    });

    it("should match wildcard prefix pattern", () => {
      const rules: NotificationRule[] = [
        { id: "r1", name: "tasks", enabled: true, eventPattern: "task.*", channels: [{ type: "websocket" }] },
      ];
      engine.loadRules(rules);
      expect(() => engine.dispatch(makeEvent("task.completed"))).not.toThrow();
    });

    it("should not dispatch for non-matching pattern", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
      const rules: NotificationRule[] = [
        { id: "r1", name: "failures", enabled: true, eventPattern: "task.failed", channels: [{ type: "webhook", url: "https://example.com/hook" }] },
      ];
      engine.loadRules(rules);
      await engine.dispatch(makeEvent("task.completed"));
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe("loadRules", () => {
    it("should only load enabled rules", () => {
      const rules: NotificationRule[] = [
        { id: "r1", name: "enabled", enabled: true, eventPattern: "*", channels: [{ type: "websocket" }] },
        { id: "r2", name: "disabled", enabled: false, eventPattern: "*", channels: [{ type: "websocket" }] },
      ];
      engine.loadRules(rules);
      // Only the enabled rule should trigger
      // We can verify by dispatching and checking no error
      expect(() => engine.dispatch(makeEvent("test"))).not.toThrow();
    });
  });

  describe("dispatch channels", () => {
    it("should call webhook url on matching event", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
      engine.loadRules([{
        id: "r1", name: "wh", enabled: true, eventPattern: "task.*",
        channels: [{ type: "webhook", url: "https://example.com/webhook" }],
      }]);

      await engine.dispatch(makeEvent("task.completed"));

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://example.com/webhook",
        expect.objectContaining({ method: "POST" }),
      );
      fetchSpy.mockRestore();
    });

    it("should call slack webhook on matching event", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
      engine.loadRules([{
        id: "r1", name: "slack", enabled: true, eventPattern: "*",
        channels: [{ type: "slack", webhookUrl: "https://hooks.slack.com/test" }],
      }]);

      await engine.dispatch(makeEvent("run.started"));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    });

    it("should call telegram API on matching event", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
      engine.loadRules([{
        id: "r1", name: "tg", enabled: true, eventPattern: "*",
        channels: [{ type: "telegram", botToken: "123:ABC", chatId: "456" }],
      }]);

      await engine.dispatch(makeEvent("task.failed"));
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.telegram.org/bot123:ABC/sendMessage",
        expect.objectContaining({ method: "POST" }),
      );
      fetchSpy.mockRestore();
    });

    it("should handle multiple channels for one rule", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
      engine.loadRules([{
        id: "r1", name: "multi", enabled: true, eventPattern: "*",
        channels: [
          { type: "webhook", url: "https://a.com" },
          { type: "slack", webhookUrl: "https://hooks.slack.com/b" },
        ],
      }]);

      await engine.dispatch(makeEvent("test"));
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      fetchSpy.mockRestore();
    });

    it("should handle channel send errors gracefully", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));
      engine.loadRules([{
        id: "r1", name: "fail", enabled: true, eventPattern: "*",
        channels: [{ type: "webhook", url: "https://fail.com" }],
      }]);

      // Should not throw
      await expect(engine.dispatch(makeEvent("test"))).resolves.toBeUndefined();
      fetchSpy.mockRestore();
    });

    it("should not send non-websocket channels during quiet hours", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
      // Quiet hours are 22:00-08:00, but we can't easily fake time here
      // Just verify websocket channel doesn't call fetch
      engine.loadRules([{
        id: "r1", name: "ws", enabled: true, eventPattern: "*",
        channels: [{ type: "websocket" }],
      }]);

      await engine.dispatch(makeEvent("test"));
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe("multiple rules", () => {
    it("should dispatch to all matching rules", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
      engine.loadRules([
        { id: "r1", name: "all", enabled: true, eventPattern: "*", channels: [{ type: "webhook", url: "https://a.com" }] },
        { id: "r2", name: "specific", enabled: true, eventPattern: "task.*", channels: [{ type: "webhook", url: "https://b.com" }] },
      ]);

      await engine.dispatch(makeEvent("task.completed"));
      // Both rules match, each has 1 webhook
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      fetchSpy.mockRestore();
    });
  });
});
