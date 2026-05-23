import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../components/common/Toast";
import type { ExecutionRun, TaskDefinition } from "@ai-workbench/shared";

// Re-export everything from RTL
export * from "@testing-library/react";
export { render };

// Mock factory helpers
export function createMockRun(overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id: "run-123456",
    workingDir: "/home/user/project",
    goals: ["Fix TypeScript errors", "Add unit tests"],
    terminationConditions: ["All tests pass", "No compilation errors"],
    status: "idle",
    totalCostUsd: 0,
    totalTasksCompleted: 0,
    ...overrides,
  } satisfies ExecutionRun;
}

export function createMockTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: "task-abcdef",
    runId: "run-123456",
    type: "user_defined",
    priority: 1,
    content: "Fix all TypeScript compilation errors",
    timeoutMinutes: 60,
    agentMode: "single",
    promptJson: "",
    status: "pending",
    createdAt: Date.now() - 1800000,
    ...overrides,
  } satisfies TaskDefinition;
}

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  initialEntries?: string[];
}

export function renderWithProviders(
  ui: React.ReactElement,
  { initialEntries = ["/"], ...options }: CustomRenderOptions = {},
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <ToastProvider>{children}</ToastProvider>
      </MemoryRouter>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}

// Wait helper for async state updates
export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
