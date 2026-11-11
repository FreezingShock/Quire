/**
 * The small floating bar that appears over a selected picture. It has one button
 * per placement mode and, for the wrap modes, a Left and Right switch. It only
 * builds DOM and reports what the user picked; the live editor owns the layout.
 */

import { el } from './dom.js';
import { MEDIA_MODES, MEDIA_SIDES, isWrap } from './media-layout.js';

const SIDE_LABELS = { left: 'Left', right: 'Right' };

/**
 * `onMode(mode)` and `onSide(side)` receive what the user picked. The bar takes
 * its mousedown so the text keeps its place while a button is pressed.
 */
export function createMediaBar({ onMode, onSide }) {
  const modeButtons = MEDIA_MODES.map((mode) =>
    el(
      'button',
      {
        class: 'media-bar-btn',
        type: 'button',
        'data-mode': mode.id,
        title: mode.hint,
        'aria-label': mode.hint,
        'aria-pressed': 'false',
        onClick: () => onMode(mode.id),
      },
      mode.label,
    ),
  );
  const sideButtons = MEDIA_SIDES.map((side) =>
    el(
      'button',
      {
        class: 'media-bar-btn',
        type: 'button',
        'data-side': side,
        title: `Wrap text on the ${side}`,
        'aria-label': `Wrap text on the ${side}`,
        'aria-pressed': 'false',
        onClick: () => onSide(side),
      },
      SIDE_LABELS[side],
    ),
  );
  const sideGroup = el('div', { class: 'media-bar-group media-bar-side', role: 'group', 'aria-label': 'Wrap side' }, sideButtons);
  const root = el(
    'div',
    {
      class: 'media-bar',
      role: 'toolbar',
      'aria-label': 'Picture placement',
      hidden: true,
      onMousedown: (event) => event.preventDefault(),
    },
    el('div', { class: 'media-bar-group', role: 'group', 'aria-label': 'Placement' }, modeButtons),
    sideGroup,
  );

  return {
    el: root,
    /** Shows the bar for a layout: marks the current mode, and shows the side switch only when text wraps. */
    show(layout) {
      for (const button of modeButtons) {
        button.setAttribute('aria-pressed', String(button.dataset.mode === layout.mode));
      }
      for (const button of sideButtons) {
        button.setAttribute('aria-pressed', String(button.dataset.side === layout.side));
      }
      sideGroup.hidden = !isWrap(layout.mode);
      root.hidden = false;
    },
    hide() {
      root.hidden = true;
    },
  };
}
