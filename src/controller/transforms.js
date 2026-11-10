/** Flip, rotate, and resize for the Quire controller: transforming the current selection. Mixed into QuireApp. */

import { resizeDialog } from '../dialogs.js';
import { selectionMatrix } from '../drawing.js';

export const transformMethods = {
  // ---------- flip, rotate and resize ----------

  /** Applies a flip, a 90° turn, or a resize to the selection, about the middle of its box. */
  transformSelection(kind, kx = 1, ky = 1) {
    if (!this.selection.size || !this.entry) return;
    const { bounds } = this.inkIndex();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const id of this.selection) {
      const box = bounds.get(id);
      if (!box) continue;
      x0 = Math.min(x0, box[0]);
      y0 = Math.min(y0, box[1]);
      x1 = Math.max(x1, box[2]);
      y1 = Math.max(y1, box[3]);
    }
    if (!Number.isFinite(x0)) return;
    const m = selectionMatrix(kind, (x0 + x1) / 2, (y0 + y1) / 2, kx, ky);
    this.commit({ t: 'xform', ids: [...this.selection], m });
  },

  resizeSelection() {
    if (!this.selection.size || !this.entry) return;
    resizeDialog({ onSave: (kx, ky) => this.transformSelection('resize', kx, ky) });
  },
};
