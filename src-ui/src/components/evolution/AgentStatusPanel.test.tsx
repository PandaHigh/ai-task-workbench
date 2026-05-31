import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentStatusPanel } from "./AgentStatusPanel";

const makeWorker = (overrides = {}) => ({
  taskId: "t1",
  roleId: "developer",
  roleName: "开发者",
  taskContent: "Fix bug in auth",
  startedAt: Date.now() - 30000,
  ...overrides,
});

describe("AgentStatusPanel", () => {
  it("should show empty state when no workers", () => {
    render(<AgentStatusPanel workers={[]} />);
    expect(screen.getByText("无活跃 Worker")).toBeInTheDocument();
  });

  it("should render worker with role name", () => {
    render(<AgentStatusPanel workers={[makeWorker()]} />);
    expect(screen.getByText("开发者")).toBeInTheDocument();
  });

  it("should render worker task content", () => {
    render(<AgentStatusPanel workers={[makeWorker()]} />);
    expect(screen.getByText("Fix bug in auth")).toBeInTheDocument();
  });

  it("should show elapsed time under 60s", () => {
    render(<AgentStatusPanel workers={[makeWorker({ startedAt: Date.now() - 5000 })]} />);
    expect(screen.getByText(/5s/)).toBeInTheDocument();
  });

  it("should show elapsed time over 60s", () => {
    render(<AgentStatusPanel workers={[makeWorker({ startedAt: Date.now() - 125000 })]} />);
    expect(screen.getByText(/2m 5s/)).toBeInTheDocument();
  });

  it("should render multiple workers", () => {
    const workers = [
      makeWorker({ taskId: "t1", roleName: "开发者", roleId: "developer" }),
      makeWorker({ taskId: "t2", roleName: "测试员", roleId: "tester", taskContent: "Run tests" }),
    ];
    render(<AgentStatusPanel workers={workers} />);
    expect(screen.getByText("开发者")).toBeInTheDocument();
    expect(screen.getByText("测试员")).toBeInTheDocument();
  });
});
