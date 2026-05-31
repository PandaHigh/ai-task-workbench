import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("should render with role status", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("should render with aria-label", () => {
    render(<Spinner />);
    expect(screen.getByLabelText("加载中")).toBeInTheDocument();
  });

  it("should render small size", () => {
    const { container } = render(<Spinner size="sm" />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("16px");
  });

  it("should render medium size by default", () => {
    const { container } = render(<Spinner />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("24px");
  });

  it("should render large size", () => {
    const { container } = render(<Spinner size="lg" />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("40px");
  });

  it("should have rounded border", () => {
    const { container } = render(<Spinner />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.borderRadius).toBe("50%");
  });
});
