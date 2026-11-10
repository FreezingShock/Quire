import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntry } from '../src/model.js';
import { contentOf, sameContent } from '../src/versions.js';
import { icon } from '../src/icons.js';
import { PIXELS } from '../src/icon-pixels.js';

const CLIP = 'data:audio/webm;base64,AAAA';
const OTHER = 'data:audio/webm;base64,BBBB';

test('a version copies the voice notes its text refers to, and no others', () => {
  const entry = normalizeEntry({ body: 'Hi\n\n![Voice note](quire-audio:a1)', audio: { a1: CLIP, a2: OTHER } });
  assert.deepEqual(contentOf(entry).audio, { a1: CLIP });
});

test('a version with no voice notes has no audio field', () => {
  const entry = normalizeEntry({ body: 'Just words', audio: {} });
  assert.equal('audio' in contentOf(entry), false);
});

test('comparing versions reads voice note ids, not their data', () => {
  const entry = normalizeEntry({ body: '![Voice note](quire-audio:a1)', audio: { a1: CLIP } });
  const saved = contentOf(entry);
  // Same id and text, different bytes under it: still the same version content.
  const changed = normalizeEntry({ body: entry.body, audio: { a1: OTHER } });
  assert.equal(sameContent(entry, saved), true);
  assert.equal(sameContent(changed, saved), true);
  // A new clip referred to in the text is a change.
  const added = normalizeEntry({ body: '![Voice note](quire-audio:a2)', audio: { a2: OTHER } });
  assert.equal(sameContent(added, saved), false);
});

test('the place icon has a drawing and a Classic pixel version', () => {
  const svg = icon('place');
  assert.match(svg, /^<svg class="qi" data-ic="place"/);
  assert.match(svg, /<g class="qi-pixel"><path d="M5 2h6v1h-6z/);
  assert.ok(PIXELS.place.length > 0);
});
