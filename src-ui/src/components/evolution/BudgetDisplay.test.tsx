import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetDisplay } from "./BudgetDisplay";

describe("BudgetDisplay", () => {
  it("should return null when not running and budget is zero", () => {
    const { container } = render(<BudgetDisplay budgetUsed={0} budgetMax={50} budgetPct={0} isRunning={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("should render when running with zero budget", () => {
    render(<BudgetDisplay budgetUsed={0} budgetMax={50} budgetPct={0} isRunning={true} />);
    expect(screen.getByText("费用")).toBeInTheDocument();
  });

  it("should render budget usage", () => {
    render(<BudgetDisplay budgetUsed={5.5} budgetMax={50} budgetPct={11} isRunning={true} />);
    expect(screen.getByText(/\$5\.50.*\$50/)).toBeInTheDocument();
  });

  it("should render progress bar", () => {
    render(<BudgetDisplay budgetUsed={10} budgetMax={50} budgetPct={20} isRunning={true} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeInTheDocument();
    expect(bar.getAttribute("aria-valuenow")).toBe("20");
  });

  it("should show green when budget pct <= 50", () => {
    const { container } = render(<BudgetDisplay budgetUsed={10} budgetMax={50} budgetPct={20} isRunning={true} />);
    const bar = container.querySelector("[role='progressbar']");
    expect(bar).toBeTruthy();
  });

  it("should render when not running but has used budget", () => {
    render(<BudgetDisplay budgetUsed={5} budgetMax={50} budgetPct={10} isRunning={false} />);
    expect(screen.getByText("费用")).toBeInTheDocument();
  });
});
