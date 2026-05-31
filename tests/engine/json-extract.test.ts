import { describe, it, expect } from "vitest";
import { extractJson, parseJsonOrThrow } from "../../src-engine/src/lib/json-extract.js";

// ─── extractJson ─────────────────────────────────────────────────────────

describe("extractJson", () => {
  it("strips markdown fences with json tag", () => {
    const input = '```json\n{"key": "value"}\n```';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("strips markdown fences without language tag", () => {
    const input = '```\n{"key": "value"}\n```';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("strips non-JSON prefix text before { or [", () => {
    const input = 'Here is the plan:\n{"steps": ["a", "b"]}';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ steps: ["a", "b"] });
  });

  it("strips prefix before array bracket", () => {
    const input = "The result is:\n[1, 2, 3]";
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  it("handles nested objects", () => {
    const input = '{ "a": { "b": 1 } }';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ a: { b: 1 } });
  });

  it("handles nested arrays", () => {
    const input = "[[1, 2], [3, 4]]";
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("returns cleaned text even when not valid JSON", () => {
    const input = "```json\n{broken json\n```";
    const result = extractJson(input);
    // Should return the cleaned text (fences stripped) even though it is not valid JSON
    expect(result).toContain("broken");
  });

  it("returns empty string for empty input", () => {
    expect(extractJson("")).toBe("");
  });

  it("returns plain JSON object without fences unchanged", () => {
    const input = '{"x": 42}';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ x: 42 });
  });
});

// ─── parseJsonOrThrow ─────────────────────────────────────────────────────

describe("parseJsonOrThrow", () => {
  it("parses valid JSON correctly", () => {
    const result = parseJsonOrThrow('{"name": "test", "count": 3}');
    expect(result).toEqual({ name: "test", count: 3 });
  });

  it("parses JSON from markdown fence", () => {
    const input = '```json\n{"items": [1, 2]}\n```';
    const result = parseJsonOrThrow<{ items: number[] }>(input);
    expect(result).toEqual({ items: [1, 2] });
  });

  it("throws on invalid input with truncated message", () => {
    const input = "not json at all, just plain text";
    expect(() => parseJsonOrThrow(input)).toThrow(
      `Failed to parse JSON from: ${input.substring(0, 200)}`,
    );
  });

  it("throws with truncation for very long invalid input", () => {
    const longInput = "a".repeat(300);
    expect(() => parseJsonOrThrow(longInput)).toThrow(
      `Failed to parse JSON from: ${longInput.substring(0, 200)}`,
    );
  });

  it("parses arrays", () => {
    const result = parseJsonOrThrow<string[]>('["a", "b", "c"]');
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("parses JSON with prefix text", () => {
    const input = 'Here is the result:\n{"status": "ok"}';
    const result = parseJsonOrThrow(input);
    expect(result).toEqual({ status: "ok" });
  });
});
