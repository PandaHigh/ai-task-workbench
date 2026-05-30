/**
 * Strip markdown fences and find balanced-bracket JSON in LLM output.
 */
export function extractJson(text: string): string {
  let cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();

  // Strip common non-JSON prefixes (e.g. "Here is the plan:\n")
  const jsonStart = Math.min(
    cleaned.indexOf("{") === -1 ? Infinity : cleaned.indexOf("{"),
    cleaned.indexOf("[") === -1 ? Infinity : cleaned.indexOf("["),
  );
  if (jsonStart > 0 && jsonStart !== Infinity) {
    cleaned = cleaned.substring(jsonStart);
  }

  try { JSON.parse(cleaned); return cleaned; } catch { /* not pure JSON */ }

  const balanced = findBalancedJson(cleaned);
  return balanced || cleaned;
}

export function parseJsonOrThrow<T>(text: string): T {
  let cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();

  const jsonStart = Math.min(
    cleaned.indexOf("{") === -1 ? Infinity : cleaned.indexOf("{"),
    cleaned.indexOf("[") === -1 ? Infinity : cleaned.indexOf("["),
  );
  if (jsonStart > 0 && jsonStart !== Infinity) {
    cleaned = cleaned.substring(jsonStart);
  }

  try { return JSON.parse(cleaned) as T; } catch { /* try balanced */ }

  const balanced = findBalancedJson(cleaned);
  if (balanced) {
    return JSON.parse(balanced) as T;
  }

  throw new Error(`Failed to parse JSON from: ${text.substring(0, 200)}`);
}

function findBalancedJson(text: string): string | null {
  const extract = (open: string, close: string): string | null => {
    const startIdx = text.indexOf(open);
    if (startIdx === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === open) depth++;
      if (ch === close) depth--;
      if (depth === 0) {
        const candidate = text.substring(startIdx, i + 1);
        try { JSON.parse(candidate); return candidate; } catch { return null; }
      }
    }
    return null;
  };

  return extract("{", "}") || extract("[", "]");
}
