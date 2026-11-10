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

test('checklist lines split into a box piece and keep the source text', () => {
  const [open, done] = parseLiveLines('- [ ] milk\n- [x]  eggs');
  assert.equal(open.cls, 'ln-task');
  assert.deepEqual(open.pieces.map((p) => p.role), ['mk', 'check', 'text', 'text']);
  assert.equal(open.pieces[1].text, '[ ]');
  assert.equal(done.cls, 'ln-task ln-task-done');
  assert.equal(documentHtml([done]).includes('<span class="lv-check" aria-hidden="true">[x]</span>'), true);
  assert.deepEqual([open, done].map((l) => l.pieces.map((p) => p.text).join('')), ['- [ ] milk', '- [x]  eggs']);
});

test('picture and sketch lines carry their media and keep the reference as text', () => {
  const lines = parseLiveLines('![Beach](quire-image:abc)\n![Sketch](quire-sketch:def)');
  assert.equal(lines[0].cls, 'ln-media');
  assert.deepEqual(lines[0].media, { alt: 'Beach', kind: 'image', id: 'abc' });
  assert.equal(lines[1].media.kind, 'sketch');
  const html = documentHtml(lines, {
    resolve: (kind, id) => (kind === 'image' && id === 'abc' ? 'blob:http://x/1' : kind === 'sketch' ? true : null),
  });
  assert.match(html, /<img class="lv-img" src="blob:http:\/\/x\/1" alt="Beach"/);
  assert.match(html, /<div class="lv-sketch" data-sketch-id="def" contenteditable="false"><\/div>/);
  // Media adds no text, so the offsets the editor uses still match the source.
  assert.equal(documentHtml(lines, { resolve: () => null }).includes('lv-missing'), true);
});
