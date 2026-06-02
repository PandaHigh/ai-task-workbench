import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("should render a text skeleton by default", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el).toBeTruthy();
  });

  it("should render with card variant", () => {
    const { container } = render(<Skeleton variant="card" height={80} />);
    expect(container.firstChild).toBeTruthy();
  });

  it("should render with circle variant", () => {
    const { container } = render(<Skeleton variant="circle" width={40} height={40} />);
    expect(container.firstChild).toBeTruthy();
  });

  it("should render multiple skeletons with count", () => {
    const { container } = render(<Skeleton count={5} />);
    expect(container.children.length).toBe(5);
  });

  it("should apply custom width", () => {
    const { container } = render(<Skeleton width={200} />);
    const el = container.firstChild as HTMLElement;
    expect(el).toBeTruthy();
  });

  it("should apply custom height", () => {
    const { container } = render(<Skeleton height={32} />);
    const el = container.firstChild as HTMLElement;
    expect(el).toBeTruthy();
  });

  it("should have aria-busy attribute", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute("aria-busy")).toBe("true");
  });
});
