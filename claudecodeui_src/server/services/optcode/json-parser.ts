/**
 * Shared JSON Parser Utility
 * Multi-strategy JSON extraction from LLM responses.
 * Used by ArchitectAgent, RepairAgent, DebugAgent, IntentRouter, etc.
 */

/**
 * Attempts to extract and parse a JSON object from an LLM response string
 * using multiple cascading strategies. Returns null if all strategies fail.
 */
export function extractJSON<T = Record<string, unknown>>(raw: string, requiredKey?: string): T | null {
  if (!raw || typeof raw !== 'string') return null;

  const strategies: (() => T | null)[] = [
    // Strategy 1: Direct parse (ideal case — LLM returned pure JSON)
    () => {
      try { return JSON.parse(raw.trim()); } catch { return null; }
    },

    // Strategy 2: Strip markdown fences from start/end
    () => {
      let cleaned = raw.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      try { return JSON.parse(cleaned.trim()); } catch { return null; }
    },

    // Strategy 3: Find JSON between code fences anywhere in the text
    () => {
      const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (fenceMatch) {
        try { return JSON.parse(fenceMatch[1].trim()); } catch { return null; }
      }
      return null;
    },

    // Strategy 4: Extract JSON object containing the required key
    () => {
      if (!requiredKey) return null;
      const pattern = new RegExp(`\\{[\\s\\S]*"${requiredKey}"[\\s\\S]*\\}`);
      const match = raw.match(pattern);
      if (match) {
        try { return JSON.parse(match[0]); } catch { return null; }
      }
      return null;
    },

    // Strategy 5: Bracket depth matching — find the outermost { ... }
    () => {
      const start = raw.indexOf('{');
      if (start === -1) return null;
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = start; i < raw.length; i++) {
        const ch = raw[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(raw.slice(start, i + 1)); } catch { return null; }
          }
        }
      }
      return null;
    },
  ];

  for (const strategy of strategies) {
    const result = strategy();
    if (result !== null && typeof result === 'object') {
      // If a required key is specified, validate it exists
      if (requiredKey && !(requiredKey in (result as Record<string, unknown>))) {
        continue;
      }
      return result;
    }
  }

  return null;
}

/**
 * Strips markdown code fences from LLM-generated code output.
 * Handles ```language\n...\n``` patterns.
 */
export function stripCodeFences(raw: string): string {
  let code = raw.trim();

  // Handle opening fence with optional language tag
  if (code.startsWith('```')) {
    const firstNewline = code.indexOf('\n');
    if (firstNewline !== -1) {
      code = code.slice(firstNewline + 1);
    } else {
      code = code.slice(3);
    }
  }

  // Handle closing fence
  if (code.endsWith('```')) {
    code = code.slice(0, -3).trimEnd();
  }

  return code;
}
