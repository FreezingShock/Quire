/**
 * Inline sketch pad. A sketch sits between paragraphs of the entry text, and its
 * strokes are ops in normalized units, the same as the page drawing. The pad
 * owns a small toolbar (pencil, brush, highlighter, eraser, undo, clear, remove)
 * and paints onto its own canvas. The ink color and width come from the toolbox,
 * so a sketch uses the color you picked for the page.
 */

import { BASE_LAYER, NORM_WIDTH, applyOp, newOpId, strokeWidth } from './drawing.js';
import { icon } from './icons.js';
import { el } from './dom.js';
import { attachKeyboardPen } from './keypen.js';

const PEN_TOOLS = [
  { id: 'pencil', label: 'Pencil', icon: 'pencil' },
  { id: 'brush', label: 'Brush', icon: 'brush' },
  { id: 'marker', label: 'Highlighter', icon: 'marker' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser' },
];

const round = (value) => Math.round(value * 10) / 10;

/** A toolbar icon as a span. The icon is SVG markup from icons.js, so it has no text. */
function iconSpan(name) {
  const span = el('span', { class: 'sketch-icon', 'aria-hidden': 'true' });
  span.innerHTML = icon(name);
  return span;
}

export class SketchPad {
  /**
   * @param {{ h: number, ops: object[] }} record the sketch in the entry. Edits change it in place.
   * @param {{ ink: () => { color: string, size: number }, onChange: () => void, onRemove: () => void }} options
   */
  constructor(record, { ink, onChange, onRemove }) {
    this.record = record;
    this.ink = ink;
    this.onChange = onChange;
    this.onRemove = onRemove;
    this.tool = 'pencil';
    this.history = []; // earlier op lists, so Undo can step back
    this.live = null; // the stroke under the pointer
    this.width = 0;

    this.canvas = el('canvas', { class: 'sketch-canvas', role: 'img', 'aria-label': 'Sketch. Drag to draw.' });
    this.ctx = this.canvas.getContext('2d');
    this.toolButtons = PEN_TOOLS.map((tool) =>
      el(
        'button',
        {
          type: 'button',
          class: 'sketch-tool',
          title: tool.label,
          'aria-label': tool.label,
          'aria-pressed': String(tool.id === this.tool),
          'data-tool': tool.id,
          onClick: () => this.setTool(tool.id),
        },
        iconSpan(tool.icon),
      ),
    );
    this.undoButton = this.iconButton('undo', 'Undo this sketch step', () => this.undo());
    this.clearButton = this.iconButton('trash', 'Clear this sketch', () => this.clear());
    this.removeButton = this.iconButton('close', 'Remove this sketch from the entry', () => this.onRemove());

    this.bar = el(
      'div',
      { class: 'sketch-bar', role: 'toolbar', 'aria-label': 'Sketch tools' },
      ...this.toolButtons,
      el('span', { class: 'sketch-sep', 'aria-hidden': 'true' }),
      this.undoButton,
      this.clearButton,
      el('span', { class: 'sketch-spacer' }),
      this.removeButton,
    );
    this.el = el('div', { class: 'sketch', contenteditable: 'false' }, this.bar, this.canvas);
    // Keep focus and text selection in the page while the sketch is used.
    this.el.addEventListener('mousedown', (event) => event.preventDefault());
    this.canvas.addEventListener('pointerdown', (event) => this.onDown(event));
    this.canvas.addEventListener('pointermove', (event) => this.onMove(event));
    this.canvas.addEventListener('pointerup', (event) => this.onUp(event));
    this.canvas.addEventListener('pointercancel', () => this.cancel());
    // Arrow keys and Space draw with the keyboard too (see keypen.js).
    this.keyPen = attachKeyboardPen(this.canvas, {
      isEnabled: () => true,
      getTool: () => this.tool,
      describe: (on) => (on ? 'Sketch. Arrow keys move the pen, Space or Enter puts it down and lifts it, Escape lifts it.' : 'Sketch.'),
    });
    this.keyPen.refresh();
    // A pad can be built while the editor is still hidden, when the canvas has no width yet.
    // The observer paints it again once the canvas is laid out.
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.sync()) : null;
    this.resizeObserver?.observe(this.canvas);
    this.paint();
  }

  /** Stops watching the canvas. Call it when the pad is dropped. */
  destroy() {
    this.resizeObserver?.disconnect();
  }

  iconButton(name, label, onClick) {
    return el('button', { type: 'button', class: 'sketch-tool', title: label, 'aria-label': label, onClick }, iconSpan(name));
  }

  setTool(id) {
    this.tool = id;
    for (const button of this.toolButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.tool === id));
    }
  }

  /** Redraws when the pad's width has changed, for example after the window is resized. */
  sync() {
    const width = this.canvas.clientWidth;
    if (width && width !== this.width) this.paint();
  }

  /** Canvas height follows the sketch height at the current width. */
  paint(ops = this.record.ops) {
    const width = this.canvas.clientWidth;
    // Hidden or not yet laid out: nothing to size against. The resize observer paints it later.
    if (!width) return;
    this.width = width;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxW = Math.round(width * dpr);
    const cssH = (this.record.h / NORM_WIDTH) * width;
    const pxH = Math.round(cssH * dpr);
    if (this.canvas.width !== pxW || this.canvas.height !== pxH) {
      this.canvas.width = pxW;
      this.canvas.height = pxH;
    }
    this.canvas.style.height = `${cssH}px`;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, pxW, pxH);
    const scale = pxW / NORM_WIDTH;
    for (const op of ops) applyOp(this.ctx, op, scale);
    if (this.live) applyOp(this.ctx, this.live, scale);
    this.undoButton.disabled = this.history.length === 0;
    this.clearButton.disabled = this.record.ops.length === 0;
  }

  /** A point in normalized units, with pressure when a pen gives one. */
  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    const k = NORM_WIDTH / (rect.width || 1);
    const x = round((event.clientX - rect.left) * k);
    const y = round((event.clientY - rect.top) * k);
    if (event.pointerType === 'pen') {
      const pressure = event.pressure > 0 ? round(event.pressure) : 0.5;
      return [x, y, pressure];
    }
    return [x, y];
  }

  onDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Keyboard pen events have no live pointer to capture; drawing still works without it.
    }
    const { color, size } = this.ink();
    this.live = {
      t: 'stroke',
      id: newOpId(),
      l: BASE_LAYER,
      tool: this.tool,
      c: color,
      w: strokeWidth(this.tool, size),
      p: [this.point(event)],
    };
    this.paint();
  }

  onMove(event) {
    if (!this.live) return;
    // Keyboard pen events have no coalesced list, and an empty one must fall back to the event itself.
    const coalesced = event.getCoalescedEvents?.() ?? [];
    const samples = coalesced.length ? coalesced : [event];
    for (const sample of samples) this.live.p.push(this.point(sample));
    this.paint();
  }

  onUp() {
    if (!this.live) return;
    const stroke = this.live;
    this.live = null;
    this.history.push(this.record.ops);
    this.record.ops = [...this.record.ops, stroke];
    this.paint();
    this.onChange();
  }

  cancel() {
    if (!this.live) return;
    this.live = null;
    this.paint();
  }

  undo() {
    if (!this.history.length) return;
    this.record.ops = this.history.pop();
    this.paint();
    this.onChange();
  }

  clear() {
    if (!this.record.ops.length) return;
    this.history.push(this.record.ops);
    this.record.ops = [];
    this.paint();
    this.onChange();
  }
}
