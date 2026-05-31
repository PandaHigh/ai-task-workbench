import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureBoard } from "./FeatureBoard";
import type { FeatureItem } from "@ai-workbench/shared";

const makeFeature = (overrides: Partial<FeatureItem> = {}): FeatureItem => ({
  id: "f1",
  passes: true,
  category: "functional",
  priority: 1,
  description: "Test feature",
  verifiedAt: undefined,
  ...overrides,
});

describe("FeatureBoard", () => {
  it("should show empty state when no features", () => {
    render(<FeatureBoard features={[]} />);
    expect(screen.getByText(/Feature list will be generated/)).toBeInTheDocument();
  });

  it("should display passed/total count", () => {
    const features = [
      makeFeature({ id: "f1", passes: true }),
      makeFeature({ id: "f2", passes: false, description: "Feature 2" }),
    ];
    render(<FeatureBoard features={features} />);
    expect(screen.getByText(/1\/2 features passed/)).toBeInTheDocument();
  });

  it("should display percentage", () => {
    const features = [makeFeature({ id: "f1", passes: true }), makeFeature({ id: "f2", passes: true })];
    render(<FeatureBoard features={features} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("should show category breakdown cards", () => {
    const features = [
      makeFeature({ id: "f1", category: "functional", passes: true }),
      makeFeature({ id: "f2", category: "non_functional", passes: false, description: "NF feature" }),
    ];
    render(<FeatureBoard features={features} />);
    expect(screen.getAllByText("功能").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("非功能").length).toBeGreaterThanOrEqual(1);
  });

  it("should show edge_case category", () => {
    const features = [makeFeature({ id: "f1", category: "edge_case" })];
    render(<FeatureBoard features={features} />);
    expect(screen.getAllByText("边界").length).toBeGreaterThanOrEqual(1);
  });

  it("should show pass/fail icons per feature", () => {
    const features = [
      makeFeature({ id: "f1", passes: true, description: "Pass feat" }),
      makeFeature({ id: "f2", passes: false, description: "Fail feat" }),
    ];
    render(<FeatureBoard features={features} />);
    expect(screen.getByText("✓")).toBeInTheDocument();
    expect(screen.getByText("○")).toBeInTheDocument();
  });

  it("should display priority labels", () => {
    const features = [makeFeature({ id: "f1", priority: 2 })];
    render(<FeatureBoard features={features} />);
    expect(screen.getByText("P2")).toBeInTheDocument();
  });

  it("should display verifiedAt time for verified features", () => {
    const features = [makeFeature({ id: "f1", verifiedAt: Date.now() })];
    render(<FeatureBoard features={features} />);
    // Should render a time string
    expect(screen.getByText(/:/)).toBeInTheDocument();
  });

  it("should use fallback style for unknown category", () => {
    const features = [makeFeature({ id: "f1", category: "custom_cat" as FeatureItem["category"] })];
    render(<FeatureBoard features={features} />);
    expect(screen.getAllByText("custom_cat").length).toBeGreaterThanOrEqual(1);
  });
});
