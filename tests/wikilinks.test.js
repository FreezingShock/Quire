import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import { renderMarkdown } from '../src/markdown.js';
import { inlinePieces } from '../src/livemarkup.js';
import { findLinkTarget, linkTitleOf, linkedFrom, linkKey, wikiLinkTitles } from '../src/wikilinks.js';

const today = '2026-06-15';
const written = (id, fields) => createEntry({ id, date: '2025-02-01', body: '', ...fields });

test('wikiLinkTitles finds distinct titles in order, ignoring case and spacing', () => {
  const body = 'See [[Harbor]] and [[  Winter   walk ]]. Again [[harbor]]. Not [[]] or [[a]b]].';
  assert.deepEqual(wikiLinkTitles(body), ['Harbor', 'Winter walk']);
  assert.equal(linkKey('  Winter   Walk '), 'winter walk');
});

test('linkTitleOf uses the title, then the first heading, and gives nothing for an untitled entry', () => {
  assert.equal(linkTitleOf(written('a', { title: 'Trip' })), 'Trip');
  assert.equal(linkTitleOf(written('b', { body: '# Harbor day\n\nText' })), 'Harbor day');
  assert.equal(linkTitleOf(written('c', { body: 'Just words' })), '');
});

test('findLinkTarget picks the newest match and never a sealed entry', () => {
  const older = written('old', { title: 'Harbor', updatedAt: '2025-01-01T00:00:00.000Z' });
  const newer = written('new', { title: 'harbor', updatedAt: '2026-03-01T00:00:00.000Z' });
  const sealed = written('sealed', { title: 'Harbor', capsule: { openOn: '2030-01-01', sealedAt: '2025-01-01T00:00:00.000Z' }, updatedAt: '2030-01-01T00:00:00.000Z' });
  assert.equal(findLinkTarget([older, newer, sealed], ' HARBOR ', today).id, 'new');
  assert.equal(findLinkTarget([sealed], 'Harbor', today), null);
  assert.equal(findLinkTarget([older], '', today), null);
});

test('linkedFrom lists the entries that link to this one, newest first, without itself or sealed ones', () => {
  const harbor = written('h', { title: 'Harbor', date: '2025-05-01' });
  const a = written('a', { title: 'Monday', date: '2025-05-02', body: 'Went to [[Harbor]].' });
  const b = written('b', { title: 'Friday', date: '2025-06-02', body: '[[harbor]] again' });
  const self = written('self', { title: 'Self', date: '2025-06-03', body: '[[Self]]' });
  const sealed = written('s', { title: 'Later', date: '2025-06-04', body: '[[Harbor]]', capsule: { openOn: '2030-01-01', sealedAt: '2025-01-01T00:00:00.000Z' } });
  const other = written('o', { title: 'Other', body: '[[Trip]]' });
  assert.deepEqual(linkedFrom([harbor, a, b, self, sealed, other], harbor, today).map((e) => e.id), ['b', 'a']);
  assert.deepEqual(linkedFrom([self], self, today), []);
  assert.deepEqual(linkedFrom([a], written('u', { body: 'No title' }), today), []);
});

test('renderMarkdown shows a link as a span and keeps the brackets out of the output', () => {
  const html = renderMarkdown('Went to [[Harbor & Co]] today.');
  assert.match(html, /<span class="wikilink">Harbor &amp; Co<\/span>/);
  assert.doesNotMatch(html, /\[\[/);
});

test('the live model marks the brackets and keeps the title as a link piece', () => {
  const pieces = inlinePieces('go [[Harbor]] now');
  const link = pieces.find((piece) => piece.role === 'wikilink');
  assert.equal(link.text, 'Harbor');
  assert.equal(pieces.filter((piece) => piece.role === 'mk').map((piece) => piece.text).join(''), '[[]]');
  assert.equal(pieces.map((piece) => piece.text).join(''), 'go [[Harbor]] now');
});
