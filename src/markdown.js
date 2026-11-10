/**
 * Small, safe Markdown renderer. Every character of input is escaped first, and
 * only a few tags are re-created afterwards, so raw HTML in an entry is shown as
 * text. The one HTML we allow is the color span the editor writes:
 * <span style="color: #rrggbb">...</span>
 *
 * Two extra block forms come from the editor:
 *   - [ ] and [x] at the start of a list item make a checklist item.
 *   - A line holding only ![alt](quire-image:<id>) or ![alt](quire-sketch:<id>)
 *     is a picture or an inline sketch. The caller decides what the id shows,
 *     through the `media` option, so the same text can render in print or in
 *     the version preview.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const SAFE_HREF = /^(https?:\/\/|mailto:|#|\/|\.{1,2}\/)/i;
const COLOR_OPEN = /&lt;span style=&quot;color:\s?(#[0-9a-f]{6})&quot;&gt;/gi;
const COLOR_CLOSE = /&lt;\/span&gt;/g;
const STASH_REF = /\u0000(\d+)\u0000/g;

/** A checklist item's text, after the list marker. Group 1 is the box, group 2 the rest. */
export const TASK_ITEM = /^\[([ xX])\](?:\s+|$)([\s\S]*)$/;
/** A whole line that is a picture (kind "image") or an inline sketch (kind "sketch"). */
export const MEDIA_LINE = /^!\[([^\]\n]*)\]\(quire-(image|sketch):([A-Za-z0-9_-]+)\)\s*$/;
/** The same reference anywhere in a line. */
export const MEDIA_REF = /!\[[^\]\n]*\]\(quire-(?:image|sketch):[A-Za-z0-9_-]+\)/g;
/** Silent reading speed for non-fiction prose: about 238 words a minute (Brysbaert, 2019, Journal of Memory and Language, 109, 104047). */
export const READING_WPM = 238;

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function renderInline(text) {
  const stash = [];
  const hold = (html) => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  let s = escapeHtml(String(text).replace(/\u0000/g, ''));
  s = s.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${code}</code>`));
  // [[Entry title]] links to another entry. The title is already escaped, so it is safe as text.
  s = s.replace(/\[\[([^[\]\n]{1,120})\]\]/g, (_, title) => hold(`<span class="wikilink">${title}</span>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    const decoded = href.replace(/&amp;/g, '&');
    return SAFE_HREF.test(decoded) ? hold(`<a href="${href}" rel="noopener noreferrer">${label}</a>`) : match;
  });
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(COLOR_OPEN, (_, hex) => `<span style="color: ${hex}">`);
  s = s.replace(COLOR_CLOSE, '</span>');
  while (/\u0000\d+\u0000/.test(s)) {
    s = s.replace(STASH_REF, (_, i) => stash[Number(i)]);
  }
  return s;
}

/** Checklist item when the text starts with a box, otherwise a plain item. */
function listItem(text) {
  const task = TASK_ITEM.exec(text);
  if (!task) return `<li>${renderInline(text)}</li>`;
  const done = task[1] !== ' ';
  const box = `<input type="checkbox" disabled${done ? ' checked' : ''}>`;
  return `<li class="task${done ? ' is-done' : ''}">${box} ${renderInline(task[2])}</li>`;
}

/** Picture or sketch, or nothing when the caller cannot resolve the id. */
function mediaHtml(match, media) {
  const [, alt, kind, id] = match;
  const src = media?.(kind, id);
  if (!src || !/^(data:image\/|blob:)/.test(src)) return '';
  return `<figure class="media"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></figure>`;
}

/**
 * Block-level pass: headings, quotes, lists, rules, fenced code and paragraphs.
 * `options.media(kind, id)` returns an image URL for a picture or sketch id, or null.
 */
export function renderMarkdown(source, options = {}) {
  const lines = String(source ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let block = null; // { type: 'p' | 'ul' | 'ol' | 'quote', items: [] }
  let fence = null; // raw lines while inside ```

  const close = () => {
    if (!block) return;
    if (block.type === 'p') {
      out.push(`<p>${block.items.map(renderInline).join('<br>')}</p>`);
    } else if (block.type === 'quote') {
      out.push(`<blockquote>${renderMarkdown(block.items.join('\n'), options)}</blockquote>`);
    } else {
      const items = block.items.map(listItem).join('');
      const cls = block.items.some((item) => TASK_ITEM.test(item)) ? ' class="task-list"' : '';
      out.push(`<${block.type}${cls}>${items}</${block.type}>`);
    }
    block = null;
  };
  const open = (type) => {
    if (!block || block.type !== type) {
      close();
      block = { type, items: [] };
    }
    return block;
  };

  for (const line of lines) {
    if (fence !== null) {
      if (/^```/.test(line.trim())) {
        out.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`);
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (/^```/.test(line.trim())) {
      close();
      fence = [];
      continue;
    }
    if (!line.trim()) {
      close();
      continue;
    }
    let match;
    if ((match = MEDIA_LINE.exec(line))) {
      close();
      const html = mediaHtml(match, options.media);
      if (html) out.push(html);
      continue;
    }
    if ((match = /^(#{1,3})\s+(.*)$/.exec(line))) {
      close();
      const level = match[1].length;
      out.push(`<h${level}>${renderInline(match[2].trim())}</h${level}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      close();
      out.push('<hr>');
      continue;
    }
    if ((match = /^>\s?(.*)$/.exec(line))) {
      open('quote').items.push(match[1]);
      continue;
    }
    if ((match = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      open('ul').items.push(match[1]);
      continue;
    }
    if ((match = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      open('ol').items.push(match[1]);
      continue;
    }
    open('p').items.push(line.trim());
  }
  if (fence !== null) out.push(`<pre><code>${escapeHtml(fence.join('\n'))}</code></pre>`);
  close();
  return out.join('\n');
}

/** Text with markup removed, used for word counts and search. Pictures, sketches and checkboxes do not count as words. */
export function plainText(source) {
  return String(source ?? '')
    .replace(MEDIA_REF, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/```/g, ' ')
    .replace(/\[([^\]\n]+)\]\([^)\s]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,3}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\[[ xX]\](?=\s|$)/gm, '')
    .replace(/[*_`[\]()!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(source) {
  const text = plainText(source);
  return text ? text.split(' ').length : 0;
}

/** Whole minutes to read `words`, at least one minute for any text. Zero for an empty entry. */
export function readingMinutes(words) {
  return words > 0 ? Math.max(1, Math.round(words / READING_WPM)) : 0;
}
