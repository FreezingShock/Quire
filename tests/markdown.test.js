import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingMinutes, renderMarkdown, wordCount } from '../src/markdown.js';

test('escapes raw HTML so entries cannot inject markup', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img/);
});

test('renders headings, quotes, lists, rules and paragraphs', () => {
  const html = renderMarkdown('# Title\n\nA line\nand more\n\n> quoted\n\n- one\n- two\n\n1. first\n\n---');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<p>A line<br>and more<\/p>/);
  assert.match(html, /<blockquote>.*quoted.*<\/blockquote>/s);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><\/ol>/);
  assert.match(html, /<hr>/);
});

test('keeps only the editor color spans and drops other inline styles', () => {
  const html = renderMarkdown('Say <span style="color: #d9342b">hi</span> and <span style="color: red">x</span>');
  assert.match(html, /<span style="color: #d9342b">hi<\/span>/);
  assert.ok(!html.includes('<span style="color: red"'));
});

test('blocks javascript: links and keeps http links', () => {
  assert.ok(!renderMarkdown('[click](javascript:alert(1))').includes('<a '));
  assert.match(renderMarkdown('[site](https://example.com)'), /<a href="https:\/\/example\.com"/);
});

test('escapes code fences and inline code', () => {
  const html = renderMarkdown('```\n<b>bold</b>\n```\n\nUse `<i>` here');
  assert.match(html, /<pre><code>&lt;b&gt;bold&lt;\/b&gt;<\/code><\/pre>/);
  assert.match(html, /<code>&lt;i&gt;<\/code>/);
});

test('emphasis works and does not leak into code', () => {
  const html = renderMarkdown('**bold** and *italic* and `**not**`');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>\*\*not\*\*<\/code>/);
});

test('word count ignores markup', () => {
  assert.equal(wordCount('# Title\n\n> Quote with **bold** words'), 5);
  assert.equal(wordCount(''), 0);
});

test('checklist items render as disabled checkboxes, checked when done', () => {
  const html = renderMarkdown('- [ ] milk\n- [x] eggs\n- plain');
  assert.match(html, /<ul class="task-list"><li class="task"><input type="checkbox" disabled> milk<\/li>/);
  assert.match(html, /<li class="task is-done"><input type="checkbox" disabled checked> eggs<\/li>/);
  assert.match(html, /<li>plain<\/li>/);
});

test('an empty checkbox still renders as a task', () => {
  assert.match(renderMarkdown('- [ ]'), /<li class="task">/);
});

test('picture and sketch lines render through the media resolver only', () => {
  const media = (kind, id) => (id === 'known' ? 'data:image/png;base64,AAAA' : null);
  const html = renderMarkdown('![Beach](quire-image:known)\n![Gone](quire-image:missing)', { media });
  assert.match(html, /<figure class="media"><img src="data:image\/png;base64,AAAA" alt="Beach"><\/figure>/);
  assert.ok(!html.includes('Gone'));
  assert.equal(renderMarkdown('![x](quire-sketch:s1)'), '');
});

test('word count and plain text skip pictures, sketches and checkboxes', () => {
  assert.equal(wordCount('- [ ] buy milk\n- [x] call mom'), 4);
  assert.equal(wordCount('![Beach](quire-image:abc)\n\nsunny day'), 2);
  assert.equal(wordCount('see [the docs](https://example.com) now'), 4);
});

test('reading time is about 238 words a minute, at least one minute for any text', () => {
  assert.equal(readingMinutes(0), 0);
  assert.equal(readingMinutes(1), 1);
  assert.equal(readingMinutes(238), 1);
  assert.equal(readingMinutes(476), 2);
  assert.equal(readingMinutes(1000), 4);
});
