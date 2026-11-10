/** The ink canvas for the Quire controller: the canvas redraw loop, pointer strokes, committing ops, and undo and redo for ink. Mixed into QuireApp. */

import { INCREMENTAL_OPS, SPRAY_STEP } from './constants.js';
import { penPressure } from './helpers.js';
import {
  InkStack,
  NORM_WIDTH,
  STAMP_SIZES,
  applyOp,
  layerOf,
  moveOp,
  opBounds,
  paintGrid,
  replayInk,
  resolveOps,
  sampleColor,
  straightCurve,
  strokeWidth,
  visibleLayerIds,
} from '../drawing.js';
import { DEFAULT_PAGE_COLOR } from '../model.js';
import { shapeEnd, snapToGrid } from '../snap.js';
import { POINTER_TOOLS, SHAPE_TOOLS } from '../tools.js';

/** The ink color a dark default page shows. Stored colors never change; only what is drawn on screen does. */
const DARK_PAGE_INK = '#e3eaf5';

/** True for near-black ink (the default black and its close shades), by luma. */
function isNearBlack(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const luma = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return luma < 80;
}

export const inkCanvasMethods = {
  // ---------- drawing ----------

  /** True when the page is the default cream shown in a dark theme, so ink must be drawn light. */
  onDarkPage() {
    return this.entry?.pageColor === DEFAULT_PAGE_COLOR && document.documentElement.dataset.theme === 'dark';
  },

  /** An op as it should look on screen. On a dark page, near-black ink is drawn light; the stored op is untouched. */
  onScreen(op) {
    if (!this.onDarkPage() || !op.c || !isNearBlack(op.c)) return op;
    return { ...op, c: DARK_PAGE_INK };
  },

  /** A stand-in for the layer stack that draws each op as it should look on screen. */
  screenStack() {
    return { apply: (op, scale) => this.stack.apply(this.onScreen(op), scale) };
  },

  requestSync() {
    if (this.syncFrame) return;
    this.syncFrame = requestAnimationFrame(() => {
      this.syncFrame = 0;
      this.syncCanvas();
    });
  },

  /** Resize the canvases to the sheet. A size change makes new layer canvases and replays the ops. */
  syncCanvas() {
    const { sheet, ink } = this.dom;
    const cssW = sheet.clientWidth;
    const cssH = sheet.clientHeight;
    if (!cssW || !cssH) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    const resized = this.base.width !== w || this.base.height !== h;
    if (resized) {
      this.base.width = w;
      this.base.height = h;
      ink.width = w;
      ink.height = h;
      this.dom.grid.width = w;
      this.dom.grid.height = h;
      this.stack = new InkStack(w, h);
    }
    this.scale = w / NORM_WIDTH;
    if (resized) this.rebuildInk();
    if (this.prefs.showGrid) paintGrid(this.gridCtx, this.scale);
    this.positionTextDraft();
    this.redraw();
  },

  /** Replays every op into the layer stack, then composites the visible layers onto the base canvas. */
  rebuildInk() {
    if (!this.stack) return;
    this.stack.setLayers(this.layers.map((layer) => layer.id));
    this.stack.reset();
    replayInk(this.screenStack(), this.drawing.ops, this.scale, this.lifted?.ids ?? null);
    this.stack.composite(this.baseCtx, visibleLayerIds(this.layers));
    this.redraw();
  },

  /** Resolved ops with their bounds. Cached until the drawing changes. */
  inkIndex() {
    if (this.index?.drawing === this.drawing && this.index.version === this.drawing.version) return this.index;
    const ops = resolveOps(this.drawing.ops);
    const bounds = new Map();
    for (const op of ops) {
      const box = opBounds(op);
      if (box) bounds.set(op.id, box);
    }
    this.index = { drawing: this.drawing, version: this.drawing.version, ops, bounds };
    return this.index;
  },

  /** Ops on visible layers only. Selection and hit tests use these. */
  visibleOps() {
    const visible = new Set(visibleLayerIds(this.layers));
    return this.inkIndex().ops.filter((op) => visible.has(layerOf(op)));
  },

  /** Device-pixel scale of the drawing layer on screen, for placing the text field. */
  inkCssScale() {
    const width = this.dom.ink.getBoundingClientRect().width;
    return width ? width / NORM_WIDTH : 1;
  },

  redraw() {
    const ctx = this.inkCtx;
    ctx.clearRect(0, 0, this.dom.ink.width, this.dom.ink.height);
    ctx.drawImage(this.base, 0, 0);
    if (this.lifted?.ops.length) {
      const { dx, dy } = this.lifted;
      for (const op of this.lifted.ops) applyOp(ctx, this.onScreen(moveOp(op, dx, dy)), this.scale);
    }
    const draft = this.draftOp();
    if (draft) applyOp(ctx, this.onScreen(draft), this.scale);
    if (this.live) {
      if (this.live.t === 'textbox') this.dashedBox(ctx, this.live.a, this.live.b);
      else applyOp(ctx, this.onScreen(this.live), this.scale);
    }
    this.drawSelectionFrame(ctx);
    this.syncXformRow();
  },

  requestRedraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.redraw();
    });
  },

  /** Dashed Paint-style box between two points in normalized units. */
  dashedBox(ctx, a, b) {
    const s = this.scale;
    const dpr = window.devicePixelRatio || 1;
    const x0 = Math.min(a[0], b[0]) * s;
    const y0 = Math.min(a[1], b[1]) * s;
    const x1 = Math.max(a[0], b[0]) * s;
    const y1 = Math.max(a[1], b[1]) * s;
    ctx.save();
    ctx.strokeStyle = '#2b5797';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    ctx.restore();
  },

  /** Dashed boxes around the selected ops, and the marquee while it is dragged. */
  drawSelectionFrame(ctx) {
    const marquee = this.selDrag?.mode === 'marquee';
    if (!this.selection.size && !marquee) return;
    const { bounds } = this.inkIndex();
    const dx = this.lifted?.dx ?? 0;
    const dy = this.lifted?.dy ?? 0;
    for (const id of this.selection) {
      const box = bounds.get(id);
      if (!box) continue;
      const moved = this.lifted?.ids.has(id);
      const ox = moved ? dx : 0;
      const oy = moved ? dy : 0;
      this.dashedBox(ctx, [box[0] + ox - 3, box[1] + oy - 3], [box[2] + ox + 3, box[3] + oy + 3]);
    }
    if (marquee) this.dashedBox(ctx, [this.selDrag.start.x, this.selDrag.start.y], [this.selDrag.end.x, this.selDrag.end.y]);
  },

  /** Records an op on the drawing and brings the canvas up to date. Drawing ops are added in place; the rest replay. */
  commit(op) {
    this.drawing.commit(op);
    this.lastSurface = 'ink';
    if (INCREMENTAL_OPS.has(op.t) && this.stack && !this.lifted) {
      this.stack.apply(op, this.scale);
      this.stack.composite(this.baseCtx, visibleLayerIds(this.layers));
      this.redraw();
    } else {
      this.rebuildInk();
    }
    this.scheduleSave();
    return op;
  },

  undoInk() {
    if (!this.drawing.undo()) return;
    this.rebuildInk();
    this.scheduleSave();
  },

  redoInk() {
    if (!this.drawing.redo()) return;
    this.rebuildInk();
    this.scheduleSave();
  },

  /** Clears one layer when `layer` is given, otherwise every layer. Undoable. */
  clearInk(layer) {
    if (this.drawing.isEmpty) return;
    this.commit(layer === undefined ? { t: 'clear' } : { t: 'clear', l: layer });
  },

  /** Undo follows the surface you touched last: ink or text. */
  undo() {
    this.commitTextDraft();
    this.commitDraft();
    if (this.lastSurface === 'ink' && this.drawing.canUndo) {
      this.undoInk();
      return;
    }
    this.dom.editor.undo();
  },

  redo() {
    this.commitTextDraft();
    this.commitDraft();
    if (this.lastSurface === 'ink' && this.drawing.canRedo) {
      this.redoInk();
      return;
    }
    this.dom.editor.redo();
  },

  pointFromEvent(event) {
    const rect = this.dom.ink.getBoundingClientRect();
    const f = NORM_WIDTH / rect.width;
    return {
      x: Math.round((event.clientX - rect.left) * f * 10) / 10,
      y: Math.round((event.clientY - rect.top) * f * 10) / 10,
    };
  },

  capturePointer(event) {
    try {
      this.dom.ink.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; drawing still works without it.
    }
    this.pointerId = event.pointerId;
  },

  onPointerDown(event) {
    if (event.button !== 0 || !POINTER_TOOLS.has(this.tool) || !this.entry) return;
    const p = this.pointFromEvent(event);
    if (this.tool === 'pick') {
      const hex = sampleColor(this.baseCtx, p.x * this.scale, p.y * this.scale) ?? this.entry?.pageColor ?? DEFAULT_PAGE_COLOR;
      this.setInk(hex);
      return;
    }
    if (this.tool === 'select') {
      event.preventDefault(); // keeps the editor from taking focus or selecting text under the sheet
      this.shiftHeld = event.shiftKey;
      this.capturePointer(event);
      this.beginSelect(event, p);
      return;
    }
    if (this.tool === 'text') {
      // Without this, the mousedown focus change blurs the text field as soon as it opens.
      event.preventDefault();
      this.commitTextDraft();
      this.capturePointer(event);
      this.beginText(p);
      return;
    }
    if (this.tool === 'magnifier') {
      this.zoomAt(event, event.shiftKey);
      return;
    }
    this.ensureActiveVisible();
    if (this.tool === 'fill') {
      this.commit({ t: 'fill', l: this.activeLayer, c: this.fg, at: [p.x, p.y] });
      return;
    }
    if (this.tool === 'stamp') {
      const size = STAMP_SIZES[this.size] ?? STAMP_SIZES[3];
      this.commit({
        t: 'stamp',
        k: this.stampKind,
        l: this.activeLayer,
        c: this.fg,
        a: this.snapPoint(p),
        s: size,
        w: Math.round(size * 0.05 * 100) / 100,
      });
      return;
    }
    if (this.tool === 'polygon') {
      // A double-click ends the shape where it stands.
      if (event.detail >= 2 && this.draft?.tool === 'polygon') {
        this.commitDraft();
        return;
      }
      this.capturePointer(event);
      this.beginPolygonPress(p);
      return;
    }
    if (this.tool === 'curve' && this.draft?.tool === 'curve') {
      this.capturePointer(event);
      this.beginBend(p);
      return;
    }
    this.capturePointer(event);
    this.shiftHeld = event.shiftKey;
    this.rawEnd = [p.x, p.y];
    const w = Math.round(strokeWidth(this.tool, this.size) * 100) / 100;
    // With snap to grid on, a drag starts on the nearest grid node.
    const start = this.snapPoint(p);
    // Only pen input records pressure. The highlighter and spray ignore it, so their strokes stay even.
    this.livePen = event.pointerType === 'pen' && this.tool !== 'marker' && this.tool !== 'spray';
    if (this.tool === 'curve') {
      this.live = { t: 'curve', l: this.activeLayer, c: this.fg, w, a: start, b: start, ...straightCurve(start, start) };
    } else if (SHAPE_TOOLS.has(this.tool)) {
      this.live = { t: this.tool, l: this.activeLayer, c: this.fg, w, a: start, b: start };
    } else {
      this.live = { t: 'stroke', l: this.activeLayer, tool: this.tool, c: this.fg, w, p: [this.livePen ? [...start, penPressure(event)] : start] };
    }
    if (this.tool === 'spray') this.startSpray();
    this.requestRedraw();
  },

  snapPoint(p) {
    return this.prefs.snapGrid ? snapToGrid([p.x, p.y]) : [p.x, p.y];
  },

  constraints() {
    return { shift: this.shiftHeld, grid: Boolean(this.prefs.snapGrid), angles: Boolean(this.prefs.snapAngles) };
  },

  /** Recomputes a shape's end from the raw pointer, so Shift and snapping apply at every move. */
  updateShapeEnd() {
    if (!this.live || !SHAPE_TOOLS.has(this.live.t) || !this.rawEnd) return;
    this.live.b = shapeEnd(this.live.t, this.live.a, this.rawEnd, this.constraints());
    if (this.live.t === 'curve') Object.assign(this.live, straightCurve(this.live.a, this.live.b));
  },

  onPointerMove(event) {
    if (this.pointerId === null || event.pointerId !== this.pointerId) return;
    this.shiftHeld = event.shiftKey;
    if (this.selDrag) {
      this.updateSelectDrag(this.pointFromEvent(event));
      this.requestRedraw();
      return;
    }
    if (this.gesture) {
      this.updateGesture(this.pointFromEvent(event));
      this.requestRedraw();
      return;
    }
    if (!this.live) return;
    if (this.live.t === 'stroke') {
      const pts = this.live.p;
      const step = this.live.tool === 'spray' ? SPRAY_STEP : 0.5;
      const coalesced = event.getCoalescedEvents?.() ?? [];
      for (const sample of coalesced.length ? coalesced : [event]) {
        const p = this.pointFromEvent(sample);
        const last = pts[pts.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) >= step) {
          pts.push(this.livePen ? [p.x, p.y, penPressure(sample)] : [p.x, p.y]);
        }
      }
    } else if (this.live.t === 'textbox') {
      const p = this.pointFromEvent(event);
      this.live.b = this.prefs.snapGrid ? snapToGrid([p.x, p.y]) : [p.x, p.y];
    } else {
      const p = this.pointFromEvent(event);
      this.rawEnd = [p.x, p.y];
      this.updateShapeEnd();
    }
    this.requestRedraw();
  },

  onPointerUp(event) {
    if (this.pointerId === null || event.pointerId !== this.pointerId) return;
    this.shiftHeld = event.shiftKey;
    this.pointerId = null;
    this.stopSpray();
    try {
      if (this.dom.ink.hasPointerCapture(event.pointerId)) this.dom.ink.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore: the pointer was already released.
    }
    if (this.selDrag) {
      this.finishSelectDrag();
      return;
    }
    if (this.gesture) {
      this.finishGesture(event);
      return;
    }
    if (!this.live) return;
    if (this.live.t === 'textbox') {
      this.finishTextBox();
      return;
    }
    if (SHAPE_TOOLS.has(this.live.t)) {
      const p = this.pointFromEvent(event);
      this.rawEnd = [p.x, p.y];
      this.updateShapeEnd();
    }
    const op = this.live;
    this.live = null;
    this.rawEnd = null;
    if (op.t === 'curve') {
      this.startCurveDraft(op);
      return;
    }
    if (op.t !== 'stroke' && op.a[0] === op.b[0] && op.a[1] === op.b[1]) {
      this.redraw();
      return;
    }
    this.commit(op);
  },
};
