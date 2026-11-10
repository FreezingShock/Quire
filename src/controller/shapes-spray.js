/** Spray can, curve, and polygon tools for the Quire controller: the pointer gestures, live previews, and their commit. Mixed into QuireApp. */

import { CLOSE_REACH_PX, MOVE_SLOP, SPRAY_TICK_MS } from './constants.js';
import { bendCurve, strokeWidth } from '../drawing.js';
import { shapeEnd } from '../snap.js';

export const sprayShapeMethods = {
  // ---------- spray, curves and polygons ----------

  startSpray() {
    this.stopSpray();
    // Holding still keeps spraying: each tick adds a sample where the pointer rests.
    this.sprayTimer = setInterval(() => {
      if (!this.live || this.live.t !== 'stroke') return;
      const last = this.live.p[this.live.p.length - 1];
      this.live.p.push([...last]);
      this.requestRedraw();
    }, SPRAY_TICK_MS);
  },

  stopSpray() {
    if (this.sprayTimer) clearInterval(this.sprayTimer);
    this.sprayTimer = 0;
  },

  /** A curve's chord is drawn; the curve is then bent by drags until it is finished. */
  startCurveDraft(op) {
    if (op.a[0] === op.b[0] && op.a[1] === op.b[1]) {
      this.redraw();
      return;
    }
    this.draft = { tool: 'curve', op: { ...op }, bends: 0 };
    this.requestRedraw();
  },

  /** Begins one bend of the pending curve. The first bend lifts the middle to the pointer; the second reshapes the far half. */
  beginBend(p) {
    const { op, bends } = this.draft;
    this.gesture = {
      kind: 'bend',
      start: p,
      moved: false,
      snap: { a: op.a, b: op.b, c1: op.c1, c2: op.c2 },
      t: bends === 0 ? 0.5 : 0.75,
      which: bends === 0 ? 'both' : 'end',
    };
  },

  /** A press on the polygon adds a side from its last point when released. A press on the first point closes it. */
  beginPolygonPress(p) {
    if (!this.draft) {
      this.draft = {
        tool: 'polygon',
        pts: [this.snapPoint(p)],
        rubber: null,
        l: this.activeLayer,
        c: this.fg,
        w: Math.round(strokeWidth('polygon', this.size) * 100) / 100,
      };
      this.gesture = { kind: 'polygon', start: p, moved: false, closing: false };
      return;
    }
    const first = this.draft.pts[0];
    const reach = CLOSE_REACH_PX / this.inkCssScale();
    const closing = this.draft.pts.length >= 3 && Math.hypot(p.x - first[0], p.y - first[1]) <= reach;
    this.gesture = { kind: 'polygon', start: p, moved: false, closing };
    this.requestRedraw();
  },

  updateGesture(p) {
    const g = this.gesture;
    if (Math.hypot(p.x - g.start.x, p.y - g.start.y) > MOVE_SLOP) g.moved = true;
    if (g.kind === 'bend') {
      Object.assign(this.draft.op, bendCurve(g.snap, g.t, [p.x, p.y], g.which));
      return;
    }
    // A side follows the pointer from the last point, and takes Shift and the snaps like a line.
    const last = this.draft.pts[this.draft.pts.length - 1];
    this.draft.rubber = shapeEnd('line', last, [p.x, p.y], this.constraints());
  },

  finishGesture(event) {
    const g = this.gesture;
    this.gesture = null;
    const d = this.draft;
    const p = this.pointFromEvent(event);
    if (g.kind === 'bend') {
      // A click without a drag finishes the curve as it stands.
      if (!g.moved) {
        this.commitDraft();
        return;
      }
      d.bends += 1;
      if (d.bends >= 2) this.commitDraft();
      else this.requestRedraw();
      return;
    }
    if (g.closing) {
      this.commitDraft(true);
      return;
    }
    const last = d.pts[d.pts.length - 1];
    const end = shapeEnd('line', last, [p.x, p.y], this.constraints());
    d.rubber = null;
    if (end[0] !== last[0] || end[1] !== last[1]) d.pts.push(end);
    this.requestRedraw();
  },

  /** The shape still being built, drawn the way it will print. */
  draftOp() {
    const d = this.draft;
    if (!d) return null;
    if (d.tool === 'curve') return d.op;
    const pts = d.rubber ? [...d.pts, d.rubber] : d.pts;
    return { t: 'poly', c: d.c, w: d.w, pts, closed: false };
  },

  /** Writes the pending curve or polygon into the drawing. A polygon needs two different points. */
  commitDraft(closed = false) {
    const d = this.draft;
    this.draft = null;
    this.gesture = null;
    if (!d) return;
    if (d.tool === 'curve') {
      this.commit({ ...d.op });
      return;
    }
    const distinct = d.pts.some((q) => q[0] !== d.pts[0][0] || q[1] !== d.pts[0][1]);
    if (d.pts.length < 2 || !distinct) {
      this.requestRedraw();
      return;
    }
    this.commit({ t: 'poly', l: d.l, c: d.c, w: d.w, pts: d.pts, closed });
  },
};
