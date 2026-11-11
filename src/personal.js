/**
 * Personal settings: the name in the greeting and the writing prompts you add
 * yourself. Pure functions, no DOM and no storage, so the Options dialog, the
 * dashboard and the tests all share one set of rules.
 */

export const NAME_MAX = 40;
export const PROMPT_MAX_COUNT = 20;
export const PROMPT_MAX_LENGTH = 200;

/** "  Nate   Anderson " -> "Nate Anderson". Non-string or blank input becomes ''. */
export function normalizeName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
}

/**
 * The prompts you wrote, cleaned up: each one trimmed and shortened, blanks
 * and repeats dropped, and the list capped at PROMPT_MAX_COUNT.
 */
export function normalizePrompts(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim().replace(/\s+/g, ' ').slice(0, PROMPT_MAX_LENGTH);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length === PROMPT_MAX_COUNT) break;
  }
  return out;
}

/** The text box holds one prompt per line. */
export function parsePromptLines(text) {
  return normalizePrompts(String(text ?? '').split(/\r?\n/));
}

export function formatPromptLines(prompts) {
  return normalizePrompts(prompts).join('\n');
}
