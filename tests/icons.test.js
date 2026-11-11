import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icon } from '../src/icons.js';

test('an icon is one svg with glow, drawing, highlight and pixel layers', () => {
  const svg = icon('write');
  assert.match(svg, /^<svg class="qi" data-ic="write"/);
  for (const layer of ['qi-glow', 'qi-main', 'qi-shine', 'qi-pixel']) assert.ok(svg.includes(`class="${layer}"`), layer);
  // The vector drawing is repeated in three layers, and the pixel layer is its own path.
  assert.equal(svg.split('<path').length - 1, 4);
});

test('an unknown icon name gives an empty drawing rather than throwing', () => {
  assert.match(icon('nope'), /data-ic="nope"/);
  assert.doesNotMatch(icon("nope"), /<path d="[^"]/);
});
