/** Stickers for the Quire controller: the sticker sheet, stamping a sticker on the page, turning and sizing it, and the sticker library. Mixed into QuireApp. */

import { confirmDialog } from '../dialogs.js';
import { altFor } from '../media.js';
import { newId } from '../model.js';
import { NORM_WIDTH, applyOp, mapOp, opBounds, rotationMatrix, scaleMatrix, translationMatrix } from '../drawing.js';
import { STICKER_SIZE, clampStickerSize, loadStickerPicture, stickerCorners, stickerFromFile, stickerKnob } from '../stickers.js';
import { openStickerSheet } from '../sticker-view.js';
import { TOOLS } from '../tools.js';
import { MOVE_SLOP } from './constants.js';

/** How close a press must be to a handle, in screen pixels. Touch needs a little more reach than a mouse. */
const HANDLE_PX = 14;
/** The round turn handle sits this far above the top edge, in screen pixels. */
const KNOB_PX = 28;

/** A turn with Shift, and with the [ and ] keys, moves in steps of 15 degrees. */
const TURN_STEP = Math.PI / 12;
/** One press of + or - scales the selected sticker by this factor. */
const GROW = 1.1;
/** Longest side of a sticker made from ink, in pixels. */
const INK_PIXELS = 512;

/**
 * A square PNG of the given ops, cropped to their bounds and centred, so the
 * sticker is never stretched. Null when the ops have no size.
 */
function inkPicture(ops) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const op of ops) {
    const box = opBounds(op);
    if (!box) continue;
    x0 = Math.min(x0, box[0]);
    y0 = Math.min(y0, box[1]);
    x1 = Math.max(x1, box[2]);
    y1 = Math.max(y1, box[3]);
  }
  if (!Number.isFinite(x0)) return null;
  const pad = 8;
  const w = x1 - x0;
  const h = y1 - y0;
  const side = Math.max(w, h, 1) + pad * 2;
  const unit = Math.min(3, INK_PIXELS / side);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(16, Math.round(side * unit));
  canvas.height = canvas.width;
  const ctx = canvas.getContext('2d');
  // Put the middle of the square at the middle of the ink.
  const ox = (x0 + x1) / 2 - side / 2;
  const oy = (y0 + y1) / 2 - side / 2;
  ctx.translate(-ox * unit, -oy * unit);
  for (const op of ops) applyOp(ctx, op, unit);
  return canvas.toDataURL('image/png');
}

export const stickerMethods = {
  // ---------- stickers ----------

  /** Menu: the sticker sheet. The library is read first, so the sheet lists every saved sticker. */
  async openStickers() {
    if (!this.entry) return;
    const entry = this.entry;
    const library = await this.store.listStickers();
    if (this.entry !== entry) return;
    this.stickerSheet = openStickerSheet({
      library,
      hasInk: this.selection.size > 0,
      onPreset: (id) => this.startStickerPlacement({ k: id }),
      onCustom: (sticker) => this.startStickerPlacement({ img: sticker.id, src: sticker.src }),
      onAddPicture: (file) => this.addStickerPicture(file),
      onRemove: (sticker) => this.removeLibrarySticker(sticker),
      onMakeFromInk: () => this.makeStickerFromInk(),
    });
  },

  async refreshStickerSheet() {
    this.stickerSheet?.refresh(await this.store.listStickers());
  },

  /** A sticker chosen from the sheet waits for the next press on the page. Escape or another tool cancels it. */
  startStickerPlacement(choice) {
    if (!this.entry) return;
    if (choice.img) loadStickerPicture(choice.img, choice.src, () => this.rebuildInk());
    this.setTool('select');
    this.stickerPlace = choice;
    this.dom.ink.dataset.placing = 'sticker';
    this.setHint('Click the page to stamp the sticker. Enter puts it in the middle. Escape cancels.');
  },

  cancelStickerPlacement() {
    if (!this.stickerPlace) return;
    this.stickerPlace = null;
    delete this.dom.ink.dataset.placing;
    this.setHint(TOOLS.find((tool) => tool.id === 'select').hint);
  },

  setHint(text) {
    if (this.dom.hint) this.dom.hint.textContent = text;
  },

  /**
   * Stamps the chosen sticker centred on p, in normalized page units, then
   * selects it so it can be moved, sized and turned at once.
   */
  placeStickerAt(p) {
    const choice = this.stickerPlace;
    if (!choice || !this.entry) return;
    this.cancelStickerPlacement();
    this.ensureActiveVisible();
    const op = { t: 'sticker', l: this.activeLayer, a: this.snapPoint(p), s: STICKER_SIZE, r: 0, m: 0 };
    if (choice.img) {
      // The picture is copied onto the entry, so the sticker still shows if the library copy goes.
      if (!Object.hasOwn(this.entry.images, choice.img)) this.entry.images[choice.img] = choice.src;
      op.img = choice.img;
    } else {
      op.k = choice.k;
    }
    const placed = this.commit(op);
    this.selection = new Set([placed.id]);
    this.requestRedraw();
  },

  /** Enter while a sticker waits: stamp it in the middle of the sheet. */
  placeStickerAtCenter() {
    if (!this.stickerPlace || !this.base || !this.scale) return;
    this.placeStickerAt({ x: NORM_WIDTH / 2, y: this.base.height / this.scale / 2 });
  },

  /** Loads the pictures that stickers on an entry use, so they draw. Each redraws the page once it is ready. */
  prepareStickers(entry) {
    for (const op of entry.ink?.ops ?? []) {
      if (op.t === 'sticker' && op.img) loadStickerPicture(op.img, entry.images?.[op.img], () => this.rebuildInk());
    }
  },

  /** The selected sticker, when exactly one sticker is selected. Null otherwise. */
  selectedSticker() {
    if (this.selection.size !== 1) return null;
    const [id] = this.selection;
    const op = this.visibleOps().find((item) => item.id === id);
    return op?.t === 'sticker' ? op : null;
  },

  /** The sticker as it is drawn right now, including a drag in progress. */
  shownSticker(op) {
    if (!this.lifted?.ids.has(op.id)) return op;
    const source = this.lifted.ops.find((item) => item.id === op.id) ?? op;
    return mapOp(source, this.liftMatrix());
  },

  /** The handle under p on the selected sticker: 'scale' at a corner, 'turn' at the round handle. Null when none. */
  stickerHandleAt(p) {
    const op = this.selectedSticker();
    if (!op) return null;
    const scale = this.inkCssScale();
    const reach = HANDLE_PX / scale;
    if (stickerCorners(op).some(([x, y]) => Math.hypot(p.x - x, p.y - y) <= reach)) return { op, mode: 'scale' };
    const [kx, ky] = stickerKnob(op, KNOB_PX / scale);
    if (Math.hypot(p.x - kx, p.y - ky) <= reach) return { op, mode: 'turn' };
    return null;
  },

  /** A press on a handle starts a resize or a turn. Returns false when the press missed every handle. */
  beginStickerHandle(p) {
    const hit = this.stickerHandleAt(p);
    if (!hit) return false;
    const { op, mode } = hit;
    const [cx, cy] = op.a;
    this.gesture = {
      kind: 'sticker',
      mode,
      id: op.id,
      center: [cx, cy],
      start: p,
      startAngle: Math.atan2(p.y - cy, p.x - cx),
      startDistance: Math.max(1e-6, Math.hypot(p.x - cx, p.y - cy)),
      sideAtStart: op.s,
      moved: false,
    };
    // The sticker is lifted off the base canvas, so the drag can show it turning or growing.
    this.lifted = { ids: new Set([op.id]), ops: [op], dx: 0, dy: 0, m: null };
    this.rebuildInk();
    return true;
  },

  updateStickerGesture(p) {
    const g = this.gesture;
    if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > MOVE_SLOP) g.moved = true;
    const [cx, cy] = g.center;
    if (g.mode === 'turn') {
      let theta = Math.atan2(p.y - cy, p.x - cx) - g.startAngle;
      if (this.shiftHeld) theta = Math.round(theta / TURN_STEP) * TURN_STEP;
      this.lifted.m = rotationMatrix(theta, cx, cy);
      return;
    }
    const side = clampStickerSize((g.sideAtStart * Math.hypot(p.x - cx, p.y - cy)) / g.startDistance);
    this.lifted.m = scaleMatrix(side / g.sideAtStart, cx, cy);
  },

  finishStickerGesture() {
    const g = this.gesture;
    this.gesture = null;
    const m = this.lifted?.m;
    this.lifted = null;
    if (g.moved && m) this.commit({ t: 'xform', ids: [g.id], m });
    else this.rebuildInk();
  },

  /** A dashed frame around a sticker, turned with it, with corner handles and a round turn handle. */
  drawStickerFrame(ctx, op) {
    const s = this.scale;
    const dpr = window.devicePixelRatio || 1;
    const corners = stickerCorners(op).map(([x, y]) => [x * s, y * s]);
    const [kx, ky] = stickerKnob(op, KNOB_PX / this.inkCssScale()).map((v) => v * s);
    const top = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2];
    const size = 8 * dpr;
    ctx.save();
    ctx.strokeStyle = '#2b5797';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(...top);
    ctx.lineTo(kx, ky);
    ctx.stroke();
    for (const [x, y] of corners) {
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    }
    ctx.beginPath();
    ctx.arc(kx, ky, size * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  },

  /** The matrix that moves the lifted ops: a turn or resize while a handle is dragged, otherwise a plain move. */
  liftMatrix() {
    return this.lifted.m ?? translationMatrix(this.lifted.dx, this.lifted.dy);
  },

  /** + and − resize the selected sticker, and [ and ] turn it. Returns true when the key was used. */
  handleStickerKey(event) {
    const op = this.selectedSticker();
    if (!op) return false;
    const actions = {
      '+': () => this.transformSticker(op, { grow: GROW }),
      '=': () => this.transformSticker(op, { grow: GROW }),
      '-': () => this.transformSticker(op, { grow: 1 / GROW }),
      _: () => this.transformSticker(op, { grow: 1 / GROW }),
      '[': () => this.transformSticker(op, { turn: -TURN_STEP }),
      ']': () => this.transformSticker(op, { turn: TURN_STEP }),
    };
    const run = actions[event.key];
    if (!run) return false;
    event.preventDefault();
    run();
    return true;
  },

  /** Records one resize or turn of a sticker about its centre, and does nothing at the size limits. */
  transformSticker(op, { grow = 1, turn = 0 }) {
    const [cx, cy] = op.a;
    if (turn) {
      this.commit({ t: 'xform', ids: [op.id], m: rotationMatrix(turn, cx, cy) });
      return;
    }
    const side = clampStickerSize(op.s * grow);
    if (side === op.s) return;
    this.commit({ t: 'xform', ids: [op.id], m: scaleMatrix(side / op.s, cx, cy) });
  },

  /** Stores the selected ink as a sticker in the library. */
  async makeStickerFromInk() {
    const ops = this.inkIndex().ops.filter((op) => this.selection.has(op.id) && op.t !== 'fill');
    const src = ops.length ? inkPicture(ops) : null;
    if (!src) {
      this.showStatus('Select some ink on the page first.', true);
      return;
    }
    const library = await this.store.listStickers();
    const sticker = { id: newId(), name: `Sticker ${library.length + 1}`, src, createdAt: new Date().toISOString() };
    await this.store.saveSticker(sticker);
    this.stickerSheet?.refresh([...library, sticker]);
  },

  /** Adds a picture from disk to the library, fitted to a square. */
  async addStickerPicture(file) {
    try {
      const src = await stickerFromFile(file);
      const library = await this.store.listStickers();
      const sticker = { id: newId(), name: altFor(file.name), src, createdAt: new Date().toISOString() };
      await this.store.saveSticker(sticker);
      this.stickerSheet?.refresh([...library, sticker]);
    } catch (error) {
      this.showStatus(`Could not add that picture: ${error.message}`, true);
    }
  },

  /** Removes a sticker from the library. Stickers already on a page keep their picture. */
  async removeLibrarySticker(sticker) {
    const ok = await confirmDialog({
      title: 'Remove sticker',
      message: `Remove “${sticker.name}” from My stickers? Stickers already on a page stay where they are.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await this.store.removeSticker(sticker.id);
    await this.refreshStickerSheet();
  },
};
