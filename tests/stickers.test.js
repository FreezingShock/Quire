import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opBounds, resolveOps, rotationMatrix, scaleMatrix, mapOp } from '../src/drawing.js';
import { PRESET_STICKERS, clampStickerSize, drawPresetArt, stickerCorners, stickerKnob } from '../src/stickers.js';
import { createMemoryStore } from '../src/storage.js';
import { createVault } from '../src/vault.js';
import { makeBackup, parseBackup } from '../src/export.js';

const sticker = (extra = {}) => ({ t: 'sticker', id: 'st1', l: 'base', a: [400, 300], s: 100, r: 0, m: 0, k: 'star', ...extra });

/** Where a sticker's local point lands on the page, using the same rule the canvas uses: mirror, then turn, then move. */
function pageOf(op, [x, y]) {
  const mirrored = op.m ? -x : x;
  const c = Math.cos(op.r ?? 0);
  const s = Math.sin(op.r ?? 0);
  return [op.a[0] + mirrored * c - y * s, op.a[1] + mirrored * s + y * c];
}

const near = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-3, `${message}: ${actual} vs ${expected}`);
};

test('a turn about a point keeps that point fixed and turns the others by the angle', () => {
  const m = rotationMatrix(Math.PI / 2, 10, 20);
  const [a, b, c, d, e, f] = m;
  const map = ([x, y]) => [a * x + c * y + e, b * x + d * y + f];
  const [cx, cy] = map([10, 20]);
  near(cx, 10, 'the centre stays put (x)');
  near(cy, 20, 'the centre stays put (y)');
  const [rx, ry] = map([20, 20]);
  near(rx, 10, 'a point to the right moves below the centre');
  near(ry, 30, 'a point to the right moves below the centre (y)');
});

test('turning a sticker moves its centre and adds the turn to its angle', () => {
  const [moved] = resolveOps([sticker({ id: 'st1' }), { t: 'xform', ids: ['st1'], m: rotationMatrix(0.5, 400, 300) }]);
  near(moved.r, 0.5, 'the turn is stored on the sticker');
  near(moved.a[0], 400, 'the centre stays on the turn point');
  near(moved.s, 100, 'the size does not change');
});

test('a resize scales the side and keeps the centre on the same spot', () => {
  const [big] = resolveOps([sticker(), { t: 'xform', ids: ['st1'], m: scaleMatrix(2, 400, 300) }]);
  near(big.s, 200, 'the side doubles');
  near(big.a[0], 400, 'the centre stays put');
});

test('a flip mirrors the sticker, and the page position of every point matches the matrix', () => {
  const original = sticker({ r: 0.3 });
  const matrices = [
    [1, 0, 0, -1, 0, 2 * 300], // flip vertically about the centre
    [-1, 0, 0, 1, 2 * 400, 0], // flip horizontally about the centre
    rotationMatrix(1.1, 400, 300),
    scaleMatrix(0.5, 400, 300),
  ];
  for (const m of matrices) {
    const [after] = resolveOps([original, { t: 'xform', ids: ['st1'], m }]);
    for (const local of [[30, 0], [0, 40], [-20, 35]]) {
      const expected = mapOp({ t: 'stroke', p: [pageOf(original, local)] }, m).p[0];
      const scaled = [local[0] * (after.s / original.s), local[1] * (after.s / original.s)];
      const [px, py] = pageOf(after, scaled);
      near(px, expected[0], `x after ${m.join(',')}`);
      near(py, expected[1], `y after ${m.join(',')}`);
    }
  }
});

test('two flips in a row bring a sticker back to where it started', () => {
  const start = sticker({ r: 0.4, m: 1 });
  const m = [-1, 0, 0, 1, 800, 0];
  const [once] = resolveOps([start, { t: 'xform', ids: ['st1'], m }]);
  const [twice] = resolveOps([start, { t: 'xform', ids: ['st1'], m }, { t: 'xform', ids: ['st1'], m }]);
  near(twice.r, start.r, 'the turn comes back');
  assert.equal(twice.m, start.m, 'the mirror comes back');
  assert.notEqual(once.m, start.m, 'a single flip toggles the mirror');
});

test('the corners of a turned sticker sit on a square of the same size', () => {
  const op = sticker({ r: Math.PI / 4 });
  const [tl, , br] = stickerCorners(op);
  near(Math.hypot(br[0] - tl[0], br[1] - tl[1]), 100 * Math.SQRT2, 'the diagonal is side times root two');
  const [kx, ky] = stickerKnob(op, 20);
  near(Math.hypot(kx - op.a[0], ky - op.a[1]), 50 + 20, 'the turn handle sits above the top edge');
});

test('bounds of a turned sticker cover its corners', () => {
  const [x0, y0, x1, y1] = opBounds(sticker({ r: Math.PI / 4 }));
  near(x1 - x0, 100 * Math.SQRT2, 'width');
  near(y1 - y0, 100 * Math.SQRT2, 'height');
});

test('sticker sizes stay inside their limits', () => {
  assert.equal(clampStickerSize(2), 16);
  assert.equal(clampStickerSize(5000), 1200);
  assert.equal(clampStickerSize(170), 170);
});

test('every preset draws something', () => {
  for (const preset of PRESET_STICKERS) {
    const calls = [];
    const gradient = { addColorStop() {} };
    const ctx = new Proxy({}, {
      get: (target, name) => {
        if (name === 'createLinearGradient' || name === 'createRadialGradient') return () => gradient;
        return (...args) => {
          calls.push(name);
          return args && undefined;
        };
      },
      set: (target, name, value) => {
        target[name] = value;
        return true;
      },
    });
    drawPresetArt(ctx, preset.id);
    assert.ok(calls.includes('fill') || calls.includes('stroke'), `${preset.id} paints a shape`);
  }
});

test('the sticker library is kept apart from entries and survives removing one', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  await store.saveSticker({ id: 'lib1', name: 'Dot', src: 'data:image/png;base64,AAAA', createdAt: '2026-01-01T00:00:00.000Z' });
  await store.save({ id: 'e1', title: 'One', body: '', images: {}, ink: { ops: [], layers: [] } });
  await store.remove('e1');
  const library = await store.listStickers();
  assert.deepEqual(library.map((item) => item.name), ['Dot']);
  await store.removeSticker('lib1');
  assert.deepEqual(await store.listStickers(), []);
});

test('the sticker library is sealed with the lock and opens again after it is turned off', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  await store.saveSticker({ id: 'lib2', name: 'Secret', src: 'data:image/png;base64,BBBB', createdAt: '2026-01-02T00:00:00.000Z' });
  const vault = createVault(await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']));
  await store.reseal(vault);
  store.setCipher(vault);
  assert.equal((await store.listStickers())[0].src, 'data:image/png;base64,BBBB');
  store.setCipher(null);
  await assert.rejects(store.listStickers());
  // Turning the lock off needs the vault still open, so the records can be read and rewritten plain.
  store.setCipher(vault);
  await store.reseal(null);
  store.setCipher(null);
  assert.equal((await store.listStickers())[0].name, 'Secret');
});

test('a backup carries the sticker library, and an older backup without one still opens', async () => {
  const stickers = [{ id: 'b1', name: 'Pic', src: 'data:image/png;base64,CCCC', createdAt: '2026-01-03T00:00:00.000Z' }];
  const text = await makeBackup([], [], stickers).text();
  const parsed = parseBackup(text);
  assert.deepEqual(parsed.stickers, stickers);
  const legacy = parseBackup(JSON.stringify({ app: 'quire', format: 1, entries: [] }));
  assert.deepEqual(legacy.stickers, []);
  const broken = parseBackup(JSON.stringify({ app: 'quire', format: 1, entries: [], stickers: [{ id: 'x', src: 'https://example.com/a.png' }] }));
  assert.deepEqual(broken.stickers, [], 'a sticker that is not a picture is dropped');
});
