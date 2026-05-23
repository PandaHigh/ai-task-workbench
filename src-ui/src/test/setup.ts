import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

// Mock WebSocket globally
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  static CLOSING = 2;

  readyState = MockWebSocket.OPEN;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  sentMessages: string[] = [];

  constructor(public url: string) {
    setTimeout(() => this.onopen?.({ type: "open" } as Event), 0);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ type: "close", code: 1000, reason: "" } as CloseEvent);
  }

  // Test helpers
  receiveMessage(data: unknown) {
    this.onmessage?.({ type: "message", data: JSON.stringify(data) } as MessageEvent);
  }

  simulateError() {
    this.onerror?.({ type: "error" } as Event);
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

// Suppress console.warn in tests
const originalWarn = console.warn;
vi.spyOn(console, "warn").mockImplementation((...args) => {
  if (typeof args[0] === "string" && args[0].includes("[engine-client]")) return;
  originalWarn(...args);
});
