import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_LIMIT,
  DEFAULT_CUSTOM,
  MESSAGE_MAX,
  NAME_MAX,
  customIdOf,
  customKind,
  normalizeCustom,
  normalizeCustoms,
  pickCustom,
  speedFactor,
} from '../src/screensaver-custom.js';
import { normalizeScreensaver, sceneFor, screensaverOptions } from '../src/screensaver.js';
import { createEntry } from '../src/model.js';

const seeded = (n) => {
  let s = n;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};

function entry(fields) {
  return { ...createEntry({ body: 'Some words.', ...fields }), updatedAt: fields.updatedAt ?? '2026-01-01T00:00:00.000Z' };
}

const PNG = 'data:image/png;base64,AAAA';
const ink = [{ t: 'stroke', tool: 'pen', c: '#000', w: 4, p: [[1, 1], [2, 2]] }];

test('a missing or broken config falls back to safe defaults', () => {
  const config = normalizeCustom({ speed: 'warp', transition: 'spin', background: 'neon', color: 'red', message: 42 });
  assert.equal(config.speed, DEFAULT_CUSTOM.speed);
  assert.equal(config.transition, DEFAULT_CUSTOM.transition);
  assert.equal(config.background, DEFAULT_CUSTOM.background);
  assert.equal(config.color, DEFAULT_CUSTOM.color);
  assert.equal(config.message, '42');
  assert.equal(config.name, DEFAULT_CUSTOM.name);
  assert.match(config.id, /^c[a-z0-9]{4,24}$/);
});

test('a bad id is replaced, and a good one is kept', () => {
  assert.equal(normalizeCustom({ id: 'cabc123' }).id, 'cabc123');
  assert.notEqual(normalizeCustom({ id: '../../etc' }).id, '../../etc');
});

test('names and messages are trimmed and capped', () => {
  assert.equal(normalizeCustom({ name: '  ' }).name, DEFAULT_CUSTOM.name);
  assert.equal(normalizeCustom({ name: 'x'.repeat(200) }).name.length, NAME_MAX);
  assert.equal(normalizeCustom({ message: '  Hello   there  ' }).message, 'Hello there');
  assert.equal(normalizeCustom({ message: 'y'.repeat(300) }).message.length, MESSAGE_MAX);
});

test('item toggles default to on, and only an explicit false turns one off', () => {
  assert.deepEqual(normalizeCustom({}).items, { drawings: true, photos: true, text: true });
  assert.deepEqual(normalizeCustom({ items: { photos: false } }).items, { drawings: true, photos: false, text: true });
});

test('saved list drops junk, keeps ids unique, and stops at the limit', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `cid${i}aa`, name: `S${i}` }));
  const list = normalizeCustoms([null, 'x', { id: 'cdup12', name: 'a' }, { id: 'cdup12', name: 'b' }, ...many]);
  assert.equal(list.length, CUSTOM_LIMIT);
  assert.equal(new Set(list.map((item) => item.id)).size, list.length);
  assert.deepEqual(normalizeCustoms(undefined), []);
});

test('custom kinds round-trip through their id', () => {
  assert.equal(customKind('cabc123'), 'custom:cabc123');
  assert.equal(customIdOf('custom:cabc123'), 'cabc123');
  assert.equal(customIdOf('memories'), null);
});

test('a custom kind is only valid while that screensaver is saved', () => {
  const customs = normalizeCustoms([{ id: 'cabc123', name: 'Mine' }]);
  assert.equal(normalizeScreensaver('custom:cabc123', customs), 'custom:cabc123');
  assert.equal(normalizeScreensaver('custom:gone99', customs), 'off');
  assert.equal(normalizeScreensaver('custom:cabc123', []), 'off');
  assert.deepEqual(screensaverOptions(customs).at(-1), { id: 'custom:cabc123', label: 'Mine' });
});

test('a custom screensaver stays custom under the lock, so it can show its message', () => {
  assert.equal(sceneFor('custom:cabc123', { locked: true, hasMemories: false }), 'custom');
  assert.equal(sceneFor('custom:cabc123', { locked: false, hasMemories: true }), 'custom');
});

test('speed factors match the editor choices', () => {
  assert.equal(speedFactor({ speed: 'slow' }), 0.5);
  assert.equal(speedFactor({ speed: 'medium' }), 1);
  assert.equal(speedFactor({ speed: 'fast' }), 2);
});

test('pick draws only the chosen kinds from the chosen notebooks and tags', () => {
  const entries = [
    entry({ id: 'draw', notebook: 'Sketchbook', tags: ['travel'], ink: { ops: ink, h: 0 }, body: '' }),
    entry({ id: 'photo', notebook: 'Sketchbook', body: '', images: { p1: PNG } }),
    entry({ id: 'words', notebook: 'Journal', tags: ['winter'], body: 'Snow all week' }),
    entry({ id: 'sample', sample: true, ink: { ops: ink, h: 0 } }),
    entry({ id: 'blank', body: '', title: '' }),
  ];
  const all = normalizeCustom({});
  const everything = pickCustom(entries, all, seeded(3)).map((item) => `${item.kind}:${item.entry.id}`).sort();
  assert.deepEqual(everything, ['drawing:draw', 'photo:photo', 'text:words'], 'sample and blank entries never show');

  const onlyDrawings = normalizeCustom({ items: { drawings: true, photos: false, text: false } });
  assert.deepEqual(pickCustom(entries, onlyDrawings, seeded(3)).map((item) => item.entry.id), ['draw']);

  const sketchbook = normalizeCustom({ notebooks: ['Sketchbook'] });
  assert.deepEqual(pickCustom(entries, sketchbook, seeded(3)).map((item) => item.entry.id).sort(), ['draw', 'photo']);

  const winter = normalizeCustom({ tags: ['WINTER'] });
  assert.deepEqual(pickCustom(entries, winter, seeded(3)).map((item) => item.entry.id), ['words'], 'tag matching ignores case');
});

test('an entry with only a photo still shows it', () => {
  const picks = pickCustom([entry({ id: 'pic', body: '', images: { a: PNG } })], normalizeCustom({ items: { drawings: false, photos: true, text: false } }), seeded(1));
  assert.deepEqual(picks.map((item) => item.entry.id), ['pic']);
});

test('only the first picture on an entry is used as its photo', () => {
  const entries = [entry({ id: 'many', images: { a: PNG, b: PNG } })];
  const picks = pickCustom(entries, normalizeCustom({ items: { drawings: false, photos: true, text: false } }), seeded(1));
  assert.equal(picks.length, 1);
  assert.equal(picks[0].src, PNG);
});
