/** Toolbox rows for stamps and selection actions for the Quire controller. Mixed into QuireApp. */

import { STAMP_LABELS } from './constants.js';
import { prevent } from './helpers.js';
import { el } from '../dom.js';
import { STAMP_KINDS } from '../drawing.js';
import { icon } from '../icons.js';
import { fontLabel, fontStackFor, isSystemFont } from '../fonts.js';

export const toolboxRowMethods = {
  // ---------- toolbox rows for stamps and the selection ----------

  buildStampRow() {
    return el(
      'div',
      { class: 'stamp-row', role: 'radiogroup', 'aria-label': 'Stamp shape', hidden: this.tool !== 'stamp' },
      STAMP_KINDS.map((kind) => {
        const button = el('button', {
          class: 'stamp-btn',
          type: 'button',
          role: 'radio',
          title: STAMP_LABELS[kind],
          'aria-label': STAMP_LABELS[kind],
          'aria-checked': String(kind === this.stampKind),
          'data-stamp': kind,
          onMousedown: prevent,
          onClick: () => this.setStampKind(kind),
        });
        button.innerHTML = icon(kind);
        return button;
      }),
    );
  },

  setStampKind(kind) {
    this.stampKind = kind;
    for (const button of this.dom.stampRow.querySelectorAll('[data-stamp]')) {
      button.setAttribute('aria-checked', String(button.dataset.stamp === kind));
    }
  },

  /** A row with one button that shows the text box font and opens the picker. Shown only with the text tool. */
  buildFontRow() {
    const button = el('button', {
      class: 'font-pick-btn',
      type: 'button',
      onMousedown: prevent,
      onClick: () => this.openFontPicker('text'),
    });
    const row = el('div', { class: 'font-row', role: 'group', 'aria-label': 'Text box font', hidden: this.tool !== 'text' }, button);
    return row;
  },

  /** Shows the text box font: its name in its own face, or the writing font when none is picked. */
  renderFontRow() {
    const button = this.dom.fontRow?.querySelector('.font-pick-btn');
    if (!button) return;
    const id = this.prefs.textFont ?? this.prefs.font;
    const name = this.prefs.textFont ? fontLabel(id) : `Page: ${fontLabel(id)}`;
    button.replaceChildren(
      el('span', { class: 'font-pick-aa', style: `font-family: ${fontStackFor(id)}` }, 'Aa'),
      el('span', { class: 'font-pick-name' }, name),
    );
    button.title = 'Font for new text boxes';
    button.setAttribute('aria-label', `Text box font: ${name}. Change it`);
    button.dataset.system = String(isSystemFont(id));
  },

  buildXformRow() {
    const actions = [
      { icon: 'flipH', label: 'Flip horizontally', run: () => this.transformSelection('flip-h') },
      { icon: 'flipV', label: 'Flip vertically', run: () => this.transformSelection('flip-v') },
      { icon: 'rotate', label: 'Rotate 90° clockwise', run: () => this.transformSelection('rotate-cw') },
      { icon: 'resize', label: 'Resize selection', run: () => this.resizeSelection() },
    ];
    const hasSelection = this.selection.size > 0;
    this.xformReady = hasSelection;
    return el(
      'div',
      { class: 'xform-row', role: 'group', 'aria-label': 'Selection', hidden: this.tool !== 'select' },
      actions.map((action) => {
        const button = el('button', {
          class: 'xform-btn',
          type: 'button',
          title: action.label,
          'aria-label': action.label,
          disabled: !hasSelection,
          onMousedown: prevent,
          onClick: action.run,
        });
        button.innerHTML = icon(action.icon);
        return button;
      }),
    );
  },

  /** Enables the selection row's buttons only while something is selected. */
  syncXformRow() {
    const row = this.dom.xformRow;
    const has = this.selection.size > 0;
    if (!row || this.xformReady === has) return;
    this.xformReady = has;
    for (const button of row.querySelectorAll('button')) button.disabled = !has;
  },
};
