/**
 * Live-preview markup model. Pure string work with no DOM, so it can be unit
 * tested. It splits the entry into lines, gives each line a block class
 * (heading, quote, list, rule, code, paragraph), and splits the line's text into
 * pieces. Every piece keeps its raw characters, so the pieces of a line always
 * join back into exactly that line. The live editor depends on this: the text it
 * shows has to match the Markdown it stores.
 *
 * Inline rules mirror renderInline() in markdown.js, so the live view and the
 * exported page agree on what counts as bold, italic, code, links and colors.
 */

import { escapeHtml } from './markdown.js';

const HEADING = /^(#{1,3})(\s+)(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^(>\s?)(.*)$/;
const BULLET = /^(\s*[-*+]\s+)(.*)$/;
const NUMBERED = /^(\s*\d+[.)]\s+)(.*)$/;
const FENCE = /^\s*```/;

const INLINE = new RegExp(
  [
    '`([^`\\n]+)`', // 1: code
    '\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)', // 2, 3: link label and href
    '\\*\\*([^*\\n]+?)\\*\\*', // 4: bold
    '__([^_\\n]+?)__', // 5: bold
    '(?<![*\\w])\\*([^*\\n]+?)\\*(?!\\*)', // 6: italic
    '(?<!\\w)_([^_\\n]+?)_(?!\\w)', // 7: italic
    '<span style="color:\\s?(#[0-9a-fA-F]{6})">', // 8: color open
    '<\\/span>', // color close
  ].join('|'),
  'g',
);

function piece(text, role, color = null) {
  return { text, role, color };
}

/**
 * Splits the inline text of one line. Roles: mk (a marker that can be hidden),
 * text, code, bold, italic, link. Color spans open and close as markers, and the
 * text inside them carries the color.
 */
export function inlinePieces(text) {
  const pieces = [];
  let color = null;
  let last = 0;
  const add = (value, role, withColor = true) => {
    if (value) pieces.push(piece(value, role, withColor ? color : null));
  };

  for (const match of text.matchAll(INLINE)) {
    add(text.slice(last, match.index), 'text');
    last = match.index + match[0].length;
    if (match[1] !== undefined) {
      add('`', 'mk', false);
      add(match[1], 'code');
      add('`', 'mk', false);
    } else if (match[2] !== undefined) {
      add('[', 'mk', false);
      add(match[2], 'link');
      add(`](${match[3]})`, 'mk', false);
    } else if (match[4] !== undefined) {
      add('**', 'mk', false);
      add(match[4], 'bold');
      add('**', 'mk', false);
    } else if (match[5] !== undefined) {
      add('__', 'mk', false);
      add(match[5], 'bold');
      add('__', 'mk', false);
    } else if (match[6] !== undefined) {
      add('*', 'mk', false);
      add(match[6], 'italic');
      add('*', 'mk', false);
    } else if (match[7] !== undefined) {
      add('_', 'mk', false);
      add(match[7], 'italic');
      add('_', 'mk', false);
    } else if (match[8] !== undefined) {
      add(match[0], 'mk', false);
      color = match[8];
    } else {
      add(match[0], 'mk', false);
      color = null;
    }
  }
  add(text.slice(last), 'text');
  return pieces;
}

function classify(raw) {
  let match;
  if ((match = HEADING.exec(raw))) {
    return { cls: `ln-h${match[1].length}`, pieces: [piece(match[1] + match[2], 'mk'), ...inlinePieces(match[3])] };
  }
  if (RULE.test(raw)) {
    return { cls: 'ln-rule', pieces: [piece(raw, 'mk')] };
  }
  if ((match = QUOTE.exec(raw))) {
    return { cls: 'ln-quote', pieces: [piece(match[1], 'mk'), ...inlinePieces(match[2])] };
  }
  if ((match = BULLET.exec(raw))) {
    return { cls: 'ln-ul', pieces: [piece(match[1], 'mk'), ...inlinePieces(match[2])] };
  }
  if ((match = NUMBERED.exec(raw))) {
    return { cls: 'ln-ol', pieces: [piece(match[1], 'num'), ...inlinePieces(match[2])] };
  }
  return { cls: raw.trim() ? 'ln-p' : 'ln-blank', pieces: inlinePieces(raw) };
}

/** One entry per source line: { cls, pieces }. Fenced code is tracked across lines. */
export function parseLiveLines(source) {
  const lines = [];
  let inFence = false;
  for (const raw of String(source ?? '').split('\n')) {
    if (FENCE.test(raw)) {
      lines.push({ cls: 'ln-fence', pieces: [piece(raw, 'mk')] });
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      lines.push({ cls: 'ln-code', pieces: [piece(raw, 'text')] });
      continue;
    }
    lines.push(classify(raw));
  }
  return lines;
}

function pieceHtml({ text, role, color }) {
  const safe = escapeHtml(text);
  // Colors come from the strict hex pattern above, so they are safe to put in an attribute.
  const style = color ? ` style="color: ${color}"` : '';
  switch (role) {
    case 'mk':
      return `<span class="mk">${safe}</span>`;
    case 'num':
      return `<span class="lv-num">${safe}</span>`;
    case 'code':
      return `<code class="lv-code"${style}>${safe}</code>`;
    case 'bold':
      return `<strong${style}>${safe}</strong>`;
    case 'italic':
      return `<em${style}>${safe}</em>`;
    case 'link':
      return `<span class="lv-link"${style}>${safe}</span>`;
    default:
      return color ? `<span${style}>${safe}</span>` : safe;
  }
}

/** HTML for every line. Active lines are marked later by the editor, so markers can show there. */
export function documentHtml(lines) {
  return lines
    .map((line) => {
      const body = line.pieces.map(pieceHtml).join('');
      return `<div class="ln ${line.cls}">${body || '<br>'}</div>`;
    })
    .join('');
}
