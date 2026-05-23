import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../../test/test-utils";
import { Terminal, TerminalLine, VirtualizedTerminal } from "./Terminal";

describe("Terminal", () => {
  it("renders children", () => {
    renderWithProviders(<Terminal><div>output</div></Terminal>);
    expect(screen.getByText("output")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    renderWithProviders(<Terminal className="custom-class"><div>test</div></Terminal>);
    const el = screen.getByText("test").parentElement!;
    expect(el.className).toContain("custom-class");
  });
});

describe("TerminalLine", () => {
  it("renders plain text content", () => {
    renderWithProviders(<TerminalLine content="Hello world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders with custom color", () => {
    renderWithProviders(<TerminalLine content="colored" color="var(--red)" />);
    const span = screen.getByText("colored");
    expect(span.style.color).toBe("var(--red)");
  });

  it("renders with prefix", () => {
    renderWithProviders(<TerminalLine content="msg" prefix="$" />);
    expect(screen.getByText("$")).toBeInTheDocument();
    expect(screen.getByText("msg")).toBeInTheDocument();
  });

  it("parses ANSI color codes", () => {
    const content = "\x1b[1;31mred text\x1b[0mnormal";
    renderWithProviders(<TerminalLine content={content} />);
    expect(screen.getByText("red text")).toBeInTheDocument();
    expect(screen.getByText("normal")).toBeInTheDocument();
  });

  it("parses single code ANSI sequences", () => {
    const content = "\x1b[32mgreen\x1b[0m";
    renderWithProviders(<TerminalLine content={content} />);
    expect(screen.getByText("green")).toBeInTheDocument();
  });
});

describe("VirtualizedTerminal", () => {
  it("renders lines", () => {
    const lines = ["line 1", "line 2", "line 3"];
    renderWithProviders(<VirtualizedTerminal lines={lines} />);
    expect(screen.getByText("line 1")).toBeInTheDocument();
    expect(screen.getByText("line 3")).toBeInTheDocument();
  });

  it("handles scroll event", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    renderWithProviders(<VirtualizedTerminal lines={lines} />);
    const container = screen.getByText("line 0").closest(".font-mono")!;
    fireEvent.scroll(container);
    expect(screen.getByText("line 0")).toBeInTheDocument();
  });
});
