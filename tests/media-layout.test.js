import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MEDIA_LAYOUT,
  FLOAT_WIDTH,
  MAX_WIDTH,
  MIN_WIDTH,
  layoutForMode,
  mediaClasses,
  mediaLayoutOf,
  mediaStyle,
  normalizeMediaLayout,
  normalizeMediaLayoutEntry,
} from '../src/media-layout.js';
import { normalizeEntry } from '../src/model.js';
import { contentKey } from '../src/controller/helpers.js';
import { documentHtml, parseLiveLines } from '../src/livemarkup.js';

test('an unknown or missing mode falls back to in line, and sides are left or right', () => {
  assert.equal(normalizeMediaLayoutEntry({ mode: 'sideways' }).mode, 'inline');
  assert.equal(normalizeMediaLayoutEntry({ mode: 'square', side: 'right' }).side, 'right');
  assert.equal(normalizeMediaLayoutEntry({ mode: 'square', side: 'top' }).side, 'left');
  assert.equal(normalizeMediaLayoutEntry(null).mode, 'inline');
});

test('widths and offsets are clamped into range and NaN falls back to the default', () => {
  const tiny = normalizeMediaLayoutEntry({ mode: 'front', w: 0, dx: -9, dy: 99999 });
  assert.equal(tiny.w, MIN_WIDTH);
  assert.equal(tiny.dx, -1);
  assert.equal(tiny.dy, 4000);
  assert.equal(normalizeMediaLayoutEntry({ w: 99 }).w, MAX_WIDTH);
  assert.equal(normalizeMediaLayoutEntry({ w: Number.NaN }).w, DEFAULT_MEDIA_LAYOUT.w);
});

test('normalizeMediaLayout keeps objects only and drops arrays and junk', () => {
  assert.deepEqual(normalizeMediaLayout(undefined), {});
  assert.deepEqual(normalizeMediaLayout([{ mode: 'front' }]), {});
  const out = normalizeMediaLayout({ a: { mode: 'behind' }, b: 'nope', c: null });
  assert.deepEqual(Object.keys(out), ['a']);
  assert.equal(out.a.mode, 'behind');
});

test('a picture with no saved layout is in line', () => {
  assert.equal(mediaLayoutOf({}, 'missing'), DEFAULT_MEDIA_LAYOUT);
  assert.deepEqual(mediaClasses(DEFAULT_MEDIA_LAYOUT), ['lv-media', 'is-inline']);
});

test('switching to a floating mode gives the picture a sensible width and keeps its size in line', () => {
  const floated = layoutForMode(DEFAULT_MEDIA_LAYOUT, 'square');
  assert.equal(floated.mode, 'square');
  assert.equal(floated.w, FLOAT_WIDTH);
  const back = layoutForMode({ mode: 'behind', side: 'left', w: 0.3, dx: 0.2, dy: 40 }, 'inline');
  assert.deepEqual(back, { mode: 'inline', side: 'left', w: 0.3, dx: 0, dy: 0 });
});

test('mode classes name the placement, the wrap side, and whether the width applies', () => {
  assert.deepEqual(mediaClasses({ mode: 'tight', side: 'right', w: 0.5, dx: 0, dy: 0 }), [
    'lv-media',
    'is-tight',
    'is-sized',
    'is-wrap-right',
  ]);
  assert.deepEqual(mediaClasses({ mode: 'behind', side: 'left', w: 1, dx: 0, dy: 0 }), [
    'lv-media',
    'is-behind',
    'is-sized',
    'is-positioned',
  ]);
});

test('the style carries width and offset as custom properties', () => {
  assert.equal(mediaStyle({ mode: 'front', side: 'left', w: 0.45, dx: -0.1, dy: 12 }), '--w:0.45;--dx:-0.1;--dy:12px');
});

test('layouts survive a round trip through the entry model', () => {
  const entry = normalizeEntry({ imageLayout: { p1: { mode: 'square', side: 'right', w: 0.4 } } });
  assert.equal(entry.imageLayout.p1.mode, 'square');
  assert.deepEqual(normalizeEntry({}).imageLayout, {});
});

test('a changed placement changes the entry content key, so the save runs', () => {
  const a = normalizeEntry({ id: 'x', body: '![A](quire-image:p1)' });
  const b = normalizeEntry({ ...a, imageLayout: { p1: { mode: 'front' } } });
  assert.notEqual(contentKey(a), contentKey(b));
});

test('a picture line in a wrap mode renders its classes and a tight outline', () => {
  const lines = parseLiveLines('![Beach](quire-image:p1)');
  const layoutOf = () => ({ mode: 'tight', side: 'left', w: 0.5, dx: 0, dy: 0 });
  const html = documentHtml(lines, { resolve: () => 'blob:http://x/1', layoutOf });
  assert.match(html, /class="lv-media is-tight is-sized is-wrap-left" data-media-id="p1"/);
  assert.match(html, /shape-outside:url\(&#39;blob:http:\/\/x\/1&#39;\)/);
});

test('an in-line picture renders with the default placement', () => {
  const html = documentHtml(parseLiveLines('![Beach](quire-image:p1)'), { resolve: () => 'blob:http://x/1' });
  assert.match(html, /class="lv-media is-inline" data-media-id="p1" style="--w:1;--dx:0;--dy:0px"/);
  assert.equal(html.includes('shape-outside'), false);
});
