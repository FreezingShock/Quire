/** The magnifier view for the Quire controller: zoom steps and the zoom-in and zoom-out actions. Mixed into QuireApp. */

import { ZOOM_STEPS } from './constants.js';

export const magnifierMethods = {
  // ---------- magnifier ----------

  /** Steps the sheet to the next zoom level, or back with Shift, keeping the spot under the pointer in place. */
  zoomAt(event, out) {
    const at = ZOOM_STEPS.indexOf(this.zoom);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, at + (out ? -1 : 1)))];
    if (next !== this.zoom) this.setZoom(next, event.clientX, event.clientY);
  },

  /**
   * Zooms the sheet with CSS zoom, so text, margins and ink all grow together.
   * The ink canvas keeps its pixel size and is stretched, so memory stays flat.
   */
  setZoom(level, clientX, clientY) {
    const { sheet } = this.dom;
    const desk = sheet.parentElement;
    const deskBox = desk.getBoundingClientRect();
    const ax = clientX ?? deskBox.left + desk.clientWidth / 2;
    const ay = clientY ?? deskBox.top + desk.clientHeight / 2;
    const before = sheet.getBoundingClientRect();
    const fx = before.width ? (ax - before.left) / before.width : 0;
    const fy = before.height ? (ay - before.top) / before.height : 0;
    this.zoom = level;
    sheet.style.zoom = level === 1 ? '' : String(level);
    const after = sheet.getBoundingClientRect();
    desk.scrollLeft += after.left + fx * after.width - ax;
    desk.scrollTop += after.top + fy * after.height - ay;
    if (this.tool === 'magnifier') {
      this.dom.hint.textContent = `Zoom ${Math.round(level * 100)}%. Click to zoom in, Shift-click to zoom out.`;
    }
    this.requestSync();
  },
};
