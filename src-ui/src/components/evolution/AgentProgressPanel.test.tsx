import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockAgentProgress: Record<string, { progress: number; phase: string }> = {};

vi.mock("../../stores/evolution-store", () => ({
  useEvolutionStore: (selector: (s: { agentProgress: Record<string, { progress: number; phase: string }> }) => unknown) =>
    selector({ agentProgress: mockAgentProgress }),
}));

import { AgentProgressPanel } from "./AgentProgressPanel";

describe("AgentProgressPanel", () => {
  it("should return null when no agent progress", () => {
    Object.keys(mockAgentProgress).forEach((k) => delete mockAgentProgress[k]);
    const { container } = render(<AgentProgressPanel />);
    expect(container.innerHTML).toBe("");
  });

  it("should render progress bars for agents", () => {
    Object.keys(mockAgentProgress).forEach((k) => delete mockAgentProgress[k]);
    mockAgentProgress.planner = { progress: 80, phase: "planning" };
    mockAgentProgress.developer = { progress: 45, phase: "coding" };
    render(<AgentProgressPanel />);
    expect(screen.getByText("规划师")).toBeInTheDocument();
    expect(screen.getByText("开发者")).toBeInTheDocument();
    expect(screen.getByText("planning")).toBeInTheDocument();
    expect(screen.getByText("coding")).toBeInTheDocument();
  });

  it("should show progress bar with correct ARIA attributes", () => {
    Object.keys(mockAgentProgress).forEach((k) => delete mockAgentProgress[k]);
    mockAgentProgress.developer = { progress: 65, phase: "coding" };
    render(<AgentProgressPanel />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "65");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("should enforce minimum 3% bar width", () => {
    Object.keys(mockAgentProgress).forEach((k) => delete mockAgentProgress[k]);
    mockAgentProgress.developer = { progress: 0, phase: "idle" };
    render(<AgentProgressPanel />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveStyle({ width: "3%" });
  });

  it("should show unknown role with raw string", () => {
    Object.keys(mockAgentProgress).forEach((k) => delete mockAgentProgress[k]);
    mockAgentProgress.custom_agent = { progress: 50, phase: "working" };
    render(<AgentProgressPanel />);
    expect(screen.getByText("custom_agent")).toBeInTheDocument();
  });
});
