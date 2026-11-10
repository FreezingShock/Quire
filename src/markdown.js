/**
 * Small, safe Markdown renderer. Every character of input is escaped first, and
 * only a few tags are re-created afterwards, so raw HTML in an entry is shown as
 * text. The one HTML we allow is the color span the editor writes:
 * <span style="color: #rrggbb">...</span>
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const SAFE_HREF = /^(https?:\/\/|mailto:|#|\/|\.{1,2}\/)/i;
const COLOR_OPEN = /&lt;span style=&quot;color:\s?(#[0-9a-f]{6})&quot;&gt;/gi;
const COLOR_CLOSE = /&lt;\/span&gt;/g;
const STASH_REF = /\u0000(\d+)\u0000/g;

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

/** Block-level pass: headings, quotes, lists, rules, fenced code and paragraphs. */
export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let block = null; // { type: 'p' | 'ul' | 'ol' | 'quote', items: [] }
  let fence = null; // raw lines while inside ```

  const close = () => {
    if (!block) return;
    if (block.type === 'p') {
      out.push(`<p>${block.items.map(renderInline).join('<br>')}</p>`);
    } else if (block.type === 'quote') {
      out.push(`<blockquote>${renderMarkdown(block.items.join('\n'))}</blockquote>`);
    } else {
      const items = block.items.map((item) => `<li>${renderInline(item)}</li>`).join('');
      out.push(`<${block.type}>${items}</${block.type}>`);
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

/** Text with markup removed, used for word counts and search. */
export function plainText(source) {
  return String(source ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/```/g, ' ')
    .replace(/^\s{0,3}(#{1,3}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`[\]()!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(source) {
  const text = plainText(source);
  return text ? text.split(' ').length : 0;
}
