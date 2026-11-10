import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icon } from '../src/icons.js';

test('an icon is one svg with glow, drawing and highlight layers', () => {
  const svg = icon('write');
  assert.match(svg, /^<svg class="qi" data-ic="write"/);
  for (const layer of ['qi-glow', 'qi-main', 'qi-shine']) assert.ok(svg.includes(`class="${layer}"`), layer);
  // The drawing is repeated in each layer, so its paths appear three times.
  assert.equal(svg.split('<path').length - 1, 3);
});

test('an unknown icon name gives an empty drawing rather than throwing', () => {
  assert.match(icon('nope'), /data-ic="nope"/);
  assert.doesNotMatch(icon('nope'), /<path/);
});
