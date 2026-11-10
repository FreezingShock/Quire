import { test } from 'node:test';
import assert from 'node:assert/strict';
import { altFor, dataUrlBytes, dataUrlParts, extensionFor, imageFiles, mediaRefsIn } from '../src/media.js';

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgo=';

test('dataUrlParts reads the media type and base64 text', () => {
  assert.deepEqual(dataUrlParts(PNG_1PX), { type: 'image/png', base64: 'iVBORw0KGgo=' });
  assert.equal(dataUrlParts('https://example.com/a.png'), null);
  assert.equal(dataUrlParts(undefined), null);
});

test('dataUrlBytes decodes base64 to the original bytes', () => {
  const bytes = dataUrlBytes(PNG_1PX);
  assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]); // the PNG signature
  assert.equal(dataUrlBytes('nope'), null);
});

test('extensionFor maps known image types and falls back to png', () => {
  assert.equal(extensionFor('image/jpeg'), 'jpg');
  assert.equal(extensionFor('image/svg+xml'), 'svg');
  assert.equal(extensionFor('image/x-unknown'), 'png');
});

test('altFor drops the extension and characters that would break the Markdown', () => {
  assert.equal(altFor('Beach day [final].JPG'), 'Beach day final');
  assert.equal(altFor(''), 'Image');
  assert.equal(altFor('a'.repeat(100)).length, 60);
});

test('mediaRefsIn lists each picture or sketch once, in order', () => {
  const text = 'a\n![x](quire-image:abc)\n![s](quire-sketch:def)\n![x again](quire-image:abc)';
  assert.deepEqual(mediaRefsIn(text), [
    { kind: 'image', id: 'abc' },
    { kind: 'sketch', id: 'def' },
  ]);
});

test('imageFiles keeps only image files from a list', () => {
  const list = [{ type: 'image/png' }, { type: 'text/plain' }, null, { type: 'image/jpeg' }];
  assert.equal(imageFiles(list).length, 2);
  assert.deepEqual(imageFiles(undefined), []);
});
