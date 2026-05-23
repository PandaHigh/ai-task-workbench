import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/test-utils";
import { RobotMascot } from "./RobotMascot";

describe("RobotMascot", () => {
  it("renders with idle mood", () => {
    renderWithProviders(<RobotMascot mood="idle" />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Robot mascot, idle mood");
  });

  it("renders with thinking mood", () => {
    renderWithProviders(<RobotMascot mood="thinking" />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Robot mascot, thinking mood");
  });

  it("renders with working mood", () => {
    renderWithProviders(<RobotMascot mood="working" />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Robot mascot, working mood");
  });

  it("renders with celebrating mood", () => {
    renderWithProviders(<RobotMascot mood="celebrating" />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Robot mascot, celebrating mood");
  });

  it("renders with error mood", () => {
    renderWithProviders(<RobotMascot mood="error" />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Robot mascot, error mood");
  });

  it("applies custom size", () => {
    renderWithProviders(<RobotMascot mood="idle" size={64} />);
    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("width", "64");
    expect(svg).toHaveAttribute("height", "64");
  });

  it("defaults size to 48", () => {
    renderWithProviders(<RobotMascot mood="idle" />);
    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute("width", "48");
    expect(svg).toHaveAttribute("height", "48");
  });
});
