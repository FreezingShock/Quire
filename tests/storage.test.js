import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntry } from '../src/model.js';
import { entryFromStorage, imageRecord, mediaKey, rowOf, sketchRecord } from '../src/storage.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const ops = [{ t: 'stroke', id: 'a', pts: [[0.1, 0.2]] }];

function sampleEntry() {
  return createEntry({
    id: 'e1',
    title: 'Beach',
    body: '![Beach](quire-image:p1)\n\n![Sketch](quire-sketch:s1)',
    images: { p1: PNG },
    sketches: { s1: { h: 320, ops } },
  });
}

test('rowOf keeps the entry text and leaves pictures and sketches out', () => {
  const row = rowOf(sampleEntry());
  assert.equal(row.id, 'e1');
  assert.equal(row.title, 'Beach');
  assert.equal(row.body, '![Beach](quire-image:p1)\n\n![Sketch](quire-sketch:s1)');
  assert.equal('images' in row, false);
  assert.equal('sketches' in row, false);
});

test('a row and its media records rebuild the same entry', () => {
  const entry = sampleEntry();
  const records = [imageRecord('e1', 'p1', PNG), sketchRecord('e1', 's1', entry.sketches.s1)];
  const rebuilt = entryFromStorage(rowOf(entry), records);
  assert.deepEqual(rebuilt.images, { p1: PNG });
  assert.deepEqual(rebuilt.sketches, { s1: { h: 320, ops } });
  assert.equal(rebuilt.body, entry.body);
});

test('an entry with no media records reads back with empty pictures and sketches', () => {
  const rebuilt = entryFromStorage(rowOf(sampleEntry()), []);
  assert.deepEqual(rebuilt.images, {});
  assert.deepEqual(rebuilt.sketches, {});
});

test('media keys keep the entry, the kind and the id apart', () => {
  assert.equal(mediaKey('e1', 'image', 'x'), 'e1/image/x');
  assert.notEqual(mediaKey('e1', 'image', 'x'), mediaKey('e1', 'sketch', 'x'));
  const record = sketchRecord('e1', 's1', { h: 320, ops });
  assert.equal(record.key, 'e1/sketch/s1');
  assert.equal(record.kind, 'sketch');
});
