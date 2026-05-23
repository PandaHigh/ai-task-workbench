import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/test-utils";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders text variant by default", () => {
    renderWithProviders(<Skeleton />);
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  });

  it("renders multiple text items with count prop", () => {
    renderWithProviders(<Skeleton count={3} />);
    expect(screen.getAllByRole("progressbar")).toHaveLength(3);
  });

  it("renders card variant", () => {
    renderWithProviders(<Skeleton variant="card" />);
    const el = screen.getByRole("progressbar");
    expect(el).toHaveAttribute("aria-busy", "true");
    expect(el).toHaveAttribute("aria-label", "加载中");
  });

  it("renders card variant with custom dimensions", () => {
    renderWithProviders(<Skeleton variant="card" width={200} height={80} />);
    const el = screen.getByRole("progressbar");
    expect(el.style.width).toBe("200px");
    expect(el.style.height).toBe("80px");
  });

  it("renders circle variant", () => {
    renderWithProviders(<Skeleton variant="circle" />);
    const el = screen.getByRole("progressbar");
    expect(el.style.borderRadius).toBe("50%");
  });

  it("renders circle variant with custom size", () => {
    renderWithProviders(<Skeleton variant="circle" width={60} height={60} />);
    const el = screen.getByRole("progressbar");
    expect(el.style.width).toBe("60px");
    expect(el.style.height).toBe("60px");
  });

  it("applies custom width and height to text variant", () => {
    renderWithProviders(<Skeleton width={300} height={20} />);
    const el = screen.getByRole("progressbar");
    expect(el.style.width).toBe("300px");
    expect(el.style.height).toBe("20px");
  });

  it("uses default width/height when not provided", () => {
    renderWithProviders(<Skeleton variant="text" />);
    const el = screen.getByRole("progressbar");
    expect(el.style.width).toBe("100%");
    expect(el.style.height).toBe("14px");
  });
});
