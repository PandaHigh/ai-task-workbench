import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ExecutionGraph } from "./ExecutionGraph";
import type { TaskDefinition } from "@ai-workbench/shared";

function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: overrides.id ?? "task-1",
    runId: overrides.runId ?? "run-1",
    type: overrides.type ?? "user_defined",
    priority: overrides.priority ?? 5,
    content: overrides.content ?? "Test task",
    status: overrides.status ?? "pending",
    timeoutMinutes: overrides.timeoutMinutes ?? 60,
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  };
}

describe("ExecutionGraph", () => {
  it("should render empty state when no tasks", () => {
    const { container } = render(<ExecutionGraph tasks={[]} />);
    expect(container.textContent).toContain("暂无任务");
  });

  it("should render an SVG with one task", () => {
    const { container } = render(<ExecutionGraph tasks={[makeTask()]} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    const rects = container.querySelectorAll("rect");
    expect(rects.length).toBeGreaterThanOrEqual(1);
  });

  it("should render task labels", () => {
    const { container } = render(<ExecutionGraph tasks={[makeTask({ content: "Build feature" })]} />);
    expect(container.textContent).toContain("Build feature");
  });

  it("should render multiple tasks", () => {
    const tasks = [
      makeTask({ id: "t1", content: "Task A" }),
      makeTask({ id: "t2", content: "Task B" }),
    ];
    const { container } = render(<ExecutionGraph tasks={tasks} />);
    expect(container.textContent).toContain("Task A");
    expect(container.textContent).toContain("Task B");
  });

  it("should render dependency edges", () => {
    const tasks = [
      makeTask({ id: "t1", content: "First" }),
      makeTask({ id: "t2", content: "Second", dependsOn: ["t1"] }),
    ];
    const { container } = render(<ExecutionGraph tasks={tasks} />);
    const lines = container.querySelectorAll("line");
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it("should truncate long task content", () => {
    const longContent = "A".repeat(30);
    const { container } = render(<ExecutionGraph tasks={[makeTask({ content: longContent })]} />);
    expect(container.textContent).toContain("...");
  });

  it("should show task status", () => {
    const { container } = render(<ExecutionGraph tasks={[makeTask({ status: "completed" })]} />);
    expect(container.textContent).toContain("completed");
  });

  it("should show score for scored tasks", () => {
    const { container } = render(<ExecutionGraph tasks={[makeTask({ status: "completed", score: 0.85 })]} />);
    expect(container.textContent).toContain("85%");
  });

  it("should handle diamond dependency pattern", () => {
    const tasks = [
      makeTask({ id: "a", content: "A" }),
      makeTask({ id: "b", content: "B", dependsOn: ["a"] }),
      makeTask({ id: "c", content: "C", dependsOn: ["a"] }),
      makeTask({ id: "d", content: "D", dependsOn: ["b", "c"] }),
    ];
    const { container } = render(<ExecutionGraph tasks={tasks} />);
    expect(container.textContent).toContain("A");
    expect(container.textContent).toContain("D");
  });
});
