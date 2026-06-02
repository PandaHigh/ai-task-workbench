import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("should render title", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("should render description when provided", () => {
    render(<EmptyState title="Empty" description="No items found" />);
    expect(screen.getByText("No items found")).toBeInTheDocument();
  });

  it("should not render description when not provided", () => {
    const { container } = render(<EmptyState title="Just title" />);
    expect(container.textContent).toBe("Just title");
  });

  it("should render action button when provided", () => {
    const action = { label: "Create One", onClick: vi.fn() };
    render(<EmptyState title="Empty" action={action} />);
    expect(screen.getByText("Create One")).toBeInTheDocument();
  });

  it("should not render action button when not provided", () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("should render SVG illustration", () => {
    const { container } = render(<EmptyState title="Test" variant="queue" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("should render with default variant", () => {
    const { container } = render(<EmptyState title="Test" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
