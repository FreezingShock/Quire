import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentHtml, inlinePieces, parseLiveLines } from '../src/livemarkup.js';

const SAMPLE = [
  '# Title',
  '## Second',
  '### Third',
  '',
  'Plain line with **bold**, __bold too__, *italic*, _italic too_ and `code`.',
  'A [link](https://example.com) and a <span style="color: #c0392b">red</span> word.',
  '> quoted **text**',
  '- bullet',
  '* star bullet',
  '2) numbered',
  '---',
  '```',
  '  indented **not bold**',
  '```',
  '  spaced   out  ',
].join('\n');

test('pieces join back to every source line exactly', () => {
  const lines = parseLiveLines(SAMPLE);
  const rebuilt = lines.map((line) => line.pieces.map((p) => p.text).join(''));
  assert.deepEqual(rebuilt, SAMPLE.split('\n'));
});

test('an empty source has one blank line', () => {
  const lines = parseLiveLines('');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].cls, 'ln-blank');
});

test('block classes follow the same rules as the exported renderer', () => {
  const cls = parseLiveLines(SAMPLE).map((line) => line.cls);
  assert.deepEqual(cls.slice(0, 4), ['ln-h1', 'ln-h2', 'ln-h3', 'ln-blank']);
  assert.equal(cls[4], 'ln-p');
  assert.equal(cls[6], 'ln-quote');
  assert.equal(cls[7], 'ln-ul');
  assert.equal(cls[8], 'ln-ul');
  assert.equal(cls[9], 'ln-ol');
  assert.equal(cls[10], 'ln-rule');
  assert.equal(cls[11], 'ln-fence');
  assert.equal(cls[12], 'ln-code', 'lines inside a fence are code, not inline markup');
  assert.equal(cls[13], 'ln-fence');
});

test('a fence keeps its contents literal', () => {
  const lines = parseLiveLines('```\n**x**\n```');
  assert.equal(lines[1].pieces.length, 1);
  assert.equal(lines[1].pieces[0].role, 'text');
  assert.equal(lines[1].pieces[0].text, '**x**');
});

test('inline markers are marked as hideable, and the content gets its role', () => {
  const pieces = inlinePieces('a **b** *c* `d` [e](f)');
  const content = pieces.filter((p) => p.role !== 'mk' && p.role !== 'text').map((p) => [p.role, p.text]);
  assert.deepEqual(content, [
    ['bold', 'b'],
    ['italic', 'c'],
    ['code', 'd'],
    ['link', 'e'],
  ]);
  const markers = pieces.filter((p) => p.role === 'mk').map((p) => p.text);
  assert.ok(markers.includes('**'));
  assert.ok(markers.includes('*'));
  assert.ok(markers.includes('`'));
  assert.ok(markers.includes('](f)'));
});

test('color spans color the text between them and their tags are markers', () => {
  const pieces = inlinePieces('x <span style="color: #c0392b">red</span> y');
  const red = pieces.find((p) => p.text === 'red');
  assert.equal(red.color, '#c0392b');
  assert.equal(pieces.find((p) => p.text === 'x ').color, null);
  assert.equal(pieces.find((p) => p.text === ' y').color, null);
  assert.ok(pieces.some((p) => p.role === 'mk' && p.text === '</span>'));
});

test('an unmatched underscore or asterisk stays plain text', () => {
  const pieces = inlinePieces('snake_case and 2 * 3');
  assert.ok(pieces.every((p) => p.role === 'text'));
});

test('rendered HTML escapes raw markup', () => {
  const html = documentHtml(parseLiveLines('<script>x</script> **a**'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>a</strong>'));
});

test('empty lines render a line break so they keep their height', () => {
  const html = documentHtml(parseLiveLines('a\n\nb'));
  assert.equal(html.match(/<br>/g).length, 1);
});
