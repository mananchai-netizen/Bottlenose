function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

function findJsonEnd(text: string, start: number): number | null {
  const open = text[start];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (close === null) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') stack.push('}');
    if (ch === '[') stack.push(']');
    if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null;
      if (stack.length === 0) return i + 1;
    }
  }

  return null;
}

export function parseJsonObjectFromBrainOutput(text: string, label: string): unknown {
  const stripped = stripJsonFence(text);
  try {
    return JSON.parse(stripped);
  } catch {
    // Some models prepend a short explanation despite the prompt. Keep schema
    // validation strict, but recover the first valid JSON object/array payload.
  }

  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] !== '{' && stripped[i] !== '[') continue;

    const end = findJsonEnd(stripped, i);
    if (end === null) continue;

    try {
      return JSON.parse(stripped.slice(i, end));
    } catch {
      // Try the next possible JSON start.
    }
  }

  const preview = stripped.replace(/\s+/g, ' ').slice(0, 160);
  throw new Error(`${label} must include valid JSON. Preview: ${preview}`);
}
