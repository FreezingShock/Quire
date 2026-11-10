/**
 * Pure text-editing helpers. Each one returns an edit description
 * { from, to, insert, selStart, selEnd } instead of touching the DOM, so the
 * behaviour can be unit tested and applied to the editor in one place.
 */

const BLOCK_PREFIX = /^(?:#{1,3} |> |[-*+] |\d+[.)] )/;
const MARKERS = { h1: '# ', h2: '## ', h3: '### ', quote: '> ', ul: '- ' };
const PROBES = {
  h1: /^# /,
  h2: /^## /,
  h3: /^### /,
  quote: /^> /,
  ul: /^[-*+] /,
  ol: /^\d+[.)] /,
};

export function lineStart(text, pos) {
  if (pos <= 0) return 0;
  return text.lastIndexOf('\n', pos - 1) + 1;
}

export function lineEnd(text, pos) {
  const index = text.indexOf('\n', pos);
  return index === -1 ? text.length : index;
}

export function applyEdit(text, edit) {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

export function insertEdit(start, end, value) {
  return { from: start, to: end, insert: value, selStart: start + value.length, selEnd: start + value.length };
}

/** Heading, quote, bullet or numbered list on every line touched by the selection. Repeat to toggle off. */
export function toggleBlockEdit(text, start, end, kind) {
  const from = lineStart(text, start);
  const to = lineEnd(text, Math.max(start, end));
  const lines = text.slice(from, to).split('\n');
  const probe = PROBES[kind];
  const content = lines.filter((line) => line.trim());
  const turnOff = content.length > 0 && content.every((line) => probe.test(line));

  let n = 0;
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    const bare = line.replace(BLOCK_PREFIX, '');
    if (turnOff) return bare;
    n += 1;
    const marker = kind === 'ol' ? `${n}. ` : MARKERS[kind];
    return marker + bare;
  });
  const insert = out.join('\n');
  return { from, to, insert, selStart: from, selEnd: from + insert.length };
}

/** Wrap the selection (or the caret) in markers, such as ** for bold. */
export function wrapEdit(text, start, end, before, after) {
  const selected = text.slice(start, end);
  return {
    from: start,
    to: end,
    insert: before + selected + after,
    selStart: start + before.length,
    selEnd: start + before.length + selected.length,
  };
}

export function dividerEdit(text, start, end) {
  const prefix = start === 0 || text[start - 1] === '\n' ? '' : '\n';
  return insertEdit(start, end, `${prefix}---\n`);
}

/**
 * Wrap each non-blank line of the selection in a color span. Wrapping per line
 * keeps every span closed inside its own paragraph, so the markup stays valid.
 */
export function colorEdit(text, start, end, hex) {
  if (start === end) return null;
  const open = `<span style="color: ${hex}">`;
  const insert = text
    .slice(start, end)
    .split('\n')
    .map((segment) => {
      const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(segment);
      if (!match[2]) return segment;
      return `${match[1]}${open}${match[2]}</span>${match[3]}`;
    })
    .join('\n');
  return { from: start, to: end, insert, selStart: start, selEnd: start + insert.length };
}

/**
 * Enter inside a list continues it with the next marker. Enter on an empty item
 * ends the list by removing the marker. Returns null for ordinary lines.
 */
export function enterEdit(text, caret) {
  const from = lineStart(text, caret);
  const before = text.slice(from, caret);
  const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(before);
  if (!match) return null;
  if (!match[3].trim()) {
    return { from, to: caret, insert: '', selStart: from, selEnd: from };
  }
  const marker = /^\d/.test(match[2])
    ? `${parseInt(match[2], 10) + 1}${match[2].slice(-1)}`
    : match[2];
  const insert = `\n${match[1]}${marker} `;
  return insertEdit(caret, caret, insert);
}
