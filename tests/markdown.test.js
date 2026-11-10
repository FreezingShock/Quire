import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, wordCount } from '../src/markdown.js';

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
