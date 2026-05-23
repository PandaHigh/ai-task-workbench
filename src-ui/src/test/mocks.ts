import { vi } from "vitest";

// Create a mock EngineClient that can be controlled in tests
export function createMockEngineClient() {
  let notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null = null;
  const callMock = vi.fn();

  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    call: callMock,
    onNotification: vi.fn().mockImplementation((handler: (method: string, params: Record<string, unknown>) => void) => {
      notificationHandler = handler;
      return () => { notificationHandler = null; };
    }),

    // Test helpers
    _getNotificationHandler: () => notificationHandler,
    _simulateNotification: (method: string, params: Record<string, unknown> = {}) => {
      notificationHandler?.(method, params);
    },
  };
}
