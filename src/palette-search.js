/**
 * Matching and ranking for the command palette. Pure: no DOM and no storage,
 * so node:test covers it. A query is split into words, and every word has to
 * match somewhere in the item. A word matches as a plain substring, or as its
 * letters in order with gaps, so "nw ent" finds "New entry".
 */

const NOISE = /[^\p{L}\p{N}]+/gu;

export function normalizeText(text) {
  return String(text ?? '').toLowerCase().replace(NOISE, ' ').trim();
}

/** Score for one query word inside `hay`, or null when it does not match. */
function wordScore(word, hay) {
  const at = hay.indexOf(word);
  if (at !== -1) {
    const wordStart = at === 0 || hay[at - 1] === ' ';
    return 100 - Math.min(at, 60) + (wordStart ? 25 : 0) + word.length;
  }
  // Letters in order with gaps: the tighter the span, the better the score.
  let from = 0;
  let first = -1;
  let last = -1;
  for (const ch of word) {
    const found = hay.indexOf(ch, from);
    if (found === -1) return null;
    if (first === -1) first = found;
    last = found;
    from = found + 1;
  }
  const span = last - first + 1;
  return Math.max(1, 40 - (span - word.length) * 3);
}

/** How well `query` matches `text`, or null. Higher is better. An empty query matches with 0. */
export function matchScore(query, text) {
  const words = normalizeText(query).split(' ').filter(Boolean);
  if (!words.length) return 0;
  const hay = normalizeText(text);
  let total = 0;
  for (const word of words) {
    const score = wordScore(word, hay);
    if (score === null) return null;
    total += score;
  }
  return total;
}

/**
 * Ranks palette items against a query. Each item has `label`, and may have
 * `group` and `keywords`. A match on the label counts for more than one in the
 * group or keywords. Without a query, items keep their given order.
 */
export function rankItems(items, query, { limit = 60 } = {}) {
  const trimmed = String(query ?? '').trim();
  if (!normalizeText(trimmed)) return items.slice(0, limit);
  const ranked = [];
  items.forEach((item, index) => {
    const onLabel = matchScore(trimmed, item.label);
    const elsewhere = matchScore(trimmed, [item.keywords, item.group].filter(Boolean).join(' '));
    if (onLabel === null && elsewhere === null) return;
    const labelBonus = normalizeText(item.label).startsWith(normalizeText(trimmed)) ? 60 : 0;
    const score = (onLabel ?? 0) * 2 + (elsewhere ?? 0) + labelBonus;
    ranked.push({ item, score, index });
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.slice(0, limit).map((entry) => entry.item);
}
