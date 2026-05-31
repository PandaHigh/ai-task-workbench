import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RobotMascot } from "./RobotMascot";

describe("RobotMascot", () => {
  it("should render SVG element", () => {
    const { container } = render(<RobotMascot mood="idle" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("should render idle mood", () => {
    const { container } = render(<RobotMascot mood="idle" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("should render thinking mood", () => {
    const { container } = render(<RobotMascot mood="thinking" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("should render working mood", () => {
    const { container } = render(<RobotMascot mood="working" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("should render celebrating mood", () => {
    const { container } = render(<RobotMascot mood="celebrating" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("should render error mood", () => {
    const { container } = render(<RobotMascot mood="error" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("should apply custom size", () => {
    const { container } = render(<RobotMascot mood="idle" size={24} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("24");
    expect(svg?.getAttribute("height")).toBe("24");
  });

  it("should use default size of 56", () => {
    const { container } = render(<RobotMascot mood="idle" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("56");
  });
});
