import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ReportTab } from "./ReportTab";

describe("ReportTab", () => {
  it("should render markdown content", () => {
    const { container } = render(<ReportTab content="# Hello World" />);
    expect(container.querySelector("h1")).toBeInTheDocument();
    expect(container.textContent).toContain("Hello World");
  });

  it("should render paragraphs", () => {
    const { container } = render(<ReportTab content="This is a paragraph." />);
    expect(container.querySelector("p")).toBeInTheDocument();
  });

  it("should render lists", () => {
    const { container } = render(<ReportTab content="- Item 1\n- Item 2" />);
    const list = container.querySelector("ul");
    expect(list).toBeInTheDocument();
    expect(container.textContent).toContain("Item 1");
    expect(container.textContent).toContain("Item 2");
  });

  it("should render bold text", () => {
    const { container } = render(<ReportTab content="**bold text**" />);
    expect(container.querySelector("strong")).toBeInTheDocument();
  });

  it("should sanitize dangerous HTML", () => {
    const { container } = render(<ReportTab content='<script>alert("xss")</script>' />);
    expect(container.querySelector("script")).not.toBeInTheDocument();
  });

  it("should render code blocks", () => {
    const { container } = render(<ReportTab content="```\nconst x = 1;\n```" />);
    expect(container.querySelector("code")).toBeInTheDocument();
  });

  it("should render empty content", () => {
    const { container } = render(<ReportTab content="" />);
    expect(container.firstChild).toBeTruthy();
  });
});
