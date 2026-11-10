/** Select and move for the Quire controller: marquee selection, dragging selected ops, and nudging with the arrow keys. Mixed into QuireApp. */

import { hitOp, opsInRect } from '../drawing.js';

export const selectionMethods = {
  // ---------- select and move ----------

  /** A press on an op selects it and starts a move. A press on empty page starts a marquee. */
  beginSelect(event, p) {
    const hit = hitOp(this.visibleOps(), [p.x, p.y]);
    if (hit) {
      if (!this.selection.has(hit.id)) {
        if (!event.shiftKey) this.selection = new Set();
        this.selection.add(hit.id);
      }
      this.startMove(p);
    } else {
      if (!event.shiftKey) this.selection = new Set();
      this.selDrag = { mode: 'marquee', start: p, end: p, base: new Set(this.selection) };
    }
    this.requestRedraw();
  },

  /** Lifts the selected ops off the base canvas so the drag can show them moving. */
  startMove(p) {
    const ids = new Set(this.selection);
    const ops = this.visibleOps().filter((op) => ids.has(op.id));
    this.lifted = { ids, ops, dx: 0, dy: 0 };
    this.selDrag = { mode: 'move', start: p, end: p };
    this.rebuildInk();
  },

  updateSelectDrag(p) {
    const drag = this.selDrag;
    drag.end = p;
    if (drag.mode === 'move') {
      this.lifted.dx = p.x - drag.start.x;
      this.lifted.dy = p.y - drag.start.y;
      return;
    }
    const rect = [
      Math.min(drag.start.x, p.x),
      Math.min(drag.start.y, p.y),
      Math.max(drag.start.x, p.x),
      Math.max(drag.start.y, p.y),
    ];
    this.selection = new Set([...drag.base, ...opsInRect(this.visibleOps(), rect)]);
  },

  finishSelectDrag() {
    const drag = this.selDrag;
    this.selDrag = null;
    if (drag.mode === 'marquee') {
      this.requestRedraw();
      return;
    }
    const { ids, dx, dy } = this.lifted;
    this.lifted = null;
    if (dx || dy) this.commit({ t: 'move', ids: [...ids], dx, dy });
    else this.rebuildInk();
  },

  deleteSelection() {
    if (!this.selection.size || !this.entry) return;
    const ids = [...this.selection];
    this.selection = new Set();
    this.commit({ t: 'delete', ids });
  },

  nudgeSelection(dx, dy) {
    if (!this.selection.size || !this.entry) return;
    this.commit({ t: 'move', ids: [...this.selection], dx, dy });
  },
};
