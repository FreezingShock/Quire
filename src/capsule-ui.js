/**
 * Time capsule dialogs and drawings: the seal dialog, the notice for a closed
 * letter, the unsealing animation, and the envelope art used on tiles, rows,
 * and the dashboard. The rules live in capsule.js; this file only draws them.
 */

import { el } from './dom.js';
import { confirmDialog, showDialog } from './dialogs.js';
import { icon } from './icons.js';
import { playSound } from './sound.js';
import { formatLongDate, formatShortDate, localISODate } from './model.js';
import {
  addToISODate,
  capsuleStatus,
  countdownText,
  daysUntil,
  sealDateProblem,
  sealDateRange,
} from './capsule.js';

const PRESETS = [
  { label: '1 month', add: { months: 1 } },
  { label: '6 months', add: { months: 6 } },
  { label: '1 year', add: { years: 1 } },
  { label: '5 years', add: { years: 5 } },
];

/** A small envelope glyph for rows and lists. */
export function envelopeIcon(cls = '') {
  const span = el('span', { class: `icon capsule-icon ${cls}`.trim(), 'aria-hidden': 'true' });
  span.innerHTML = icon('envelope');
  return span;
}

/**
 * Asks for the day a capsule opens. `current` pre-fills the date when the
 * capsule already has one. `onSave(openOn)` gets the YYYY-MM-DD string.
 */
export function sealDialog({ title = 'Seal as time capsule', entryName = null, current = null, submitLabel = 'Seal it', onSave }) {
  const today = localISODate();
  const range = sealDateRange(today);
  const input = el('input', {
    class: 'dialog-input capsule-date',
    type: 'date',
    min: range.min,
    max: range.max,
    value: current ?? '',
    'aria-label': 'Day the letter opens',
    autocomplete: 'off',
  });
  const preview = el('p', { class: 'dialog-note capsule-preview', 'aria-live': 'polite' });
  const error = el('p', { class: 'dialog-error', role: 'alert' });

  const syncPreview = () => {
    const openOn = input.value;
    const problem = openOn ? sealDateProblem(openOn, today) : '';
    if (openOn && !problem) {
      const days = daysUntil(openOn, today);
      preview.textContent = `Opens ${formatLongDate(openOn)}, ${days === 1 ? 'tomorrow' : `in ${days} days`}.`;
    } else {
      preview.textContent = '';
    }
    if (!problem || !openOn) error.textContent = '';
  };
  input.addEventListener('input', syncPreview);
  input.addEventListener('change', syncPreview);

  const presets = el(
    'div',
    { class: 'capsule-presets', role: 'group', 'aria-label': 'Quick choices' },
    PRESETS.map((preset) =>
      el(
        'button',
        {
          class: 'btn',
          type: 'button',
          onClick: () => {
            input.value = addToISODate(today, preset.add);
            syncPreview();
            error.textContent = '';
          },
        },
        preset.label,
      ),
    ),
  );

  const dialog = el(
    'dialog',
    { class: 'dialog capsule-dialog' },
    el(
      'form',
      {
        class: 'dialog-form',
        // Our own message explains a bad day. The browser's native range check would hide it.
        novalidate: true,
        onSubmit: (event) => {
          event.preventDefault();
          const problem = sealDateProblem(input.value, today);
          if (problem) {
            error.textContent = problem;
            input.focus();
            return;
          }
          onSave(input.value);
          dialog.close();
        },
      },
      el('h2', { class: 'dialog-title' }, title),
      el(
        'p',
        { class: 'dialog-text' },
        `${entryName ? `Seal “${entryName}”` : 'Seal this entry'} until a day you pick. It stays closed until then. On that day it opens with a short unsealing.`,
      ),
      el('p', { class: 'capsule-label' }, 'Open on'),
      input,
      presets,
      preview,
      error,
      el(
        'div',
        { class: 'dialog-actions' },
        el('button', { class: 'btn', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
        el('button', { class: 'btn btn-primary', type: 'submit' }, submitLabel),
      ),
    ),
  );
  syncPreview();
  showDialog(dialog);
  input.focus();
  return dialog;
}

/**
 * Shown when someone opens a letter that is still sealed. It says when it
 * opens and offers two ways out: change the day, or open it early.
 * `onChangeDate()` and `onOpenEarly()` are called from its buttons.
 */
export function sealedNoticeDialog({ entry, onChangeDate, onOpenEarly }) {
  const today = localISODate();
  const days = daysUntil(entry.capsule.openOn, today);
  const dialog = el(
    'dialog',
    { class: 'dialog capsule-dialog' },
    el(
      'div',
      { class: 'dialog-form capsule-notice' },
      capsuleArt('sealed'),
      el('h2', { class: 'dialog-title' }, 'This letter is sealed'),
      el(
        'p',
        { class: 'dialog-text' },
        `It opens on ${formatLongDate(entry.capsule.openOn)}, ${days === 1 ? 'tomorrow' : `in ${days} days`}. Until then you cannot read it, and it is not shown in the lists.`,
      ),
      el(
        'div',
        { class: 'dialog-actions capsule-actions' },
        el('button', { class: 'btn btn-quiet-danger', type: 'button', onClick: () => { dialog.close(); onOpenEarly(); } }, 'Open early…'),
        el('button', { class: 'btn', type: 'button', onClick: () => { dialog.close(); onChangeDate(); } }, 'Change date…'),
        el('button', { class: 'btn btn-primary', type: 'button', onClick: () => dialog.close() }, 'Keep sealed'),
      ),
    ),
  );
  showDialog(dialog);
  return dialog;
}

/**
 * The unsealing. The seal breaks, the flap lifts, and the letter rises out of
 * the envelope. Resolves true when the reader presses Read it, and false if the
 * dialog closes first, in which case the capsule stays ready.
 */
export function unsealAnimation({ entry, animate = true }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const motion = animate && !reduce;
    const stage = capsuleArt('ready', { unsealing: motion, open: !motion });
    const read = el(
      'button',
      {
        class: 'btn btn-primary capsule-read',
        type: 'button',
        onClick: () => {
          finish(true);
          dialog.close();
        },
      },
      'Read it',
    );
    const dialog = el(
      'dialog',
      { class: 'dialog capsule-dialog capsule-unseal', 'aria-labelledby': 'capsule-unseal-title' },
      el(
        'div',
        { class: 'dialog-form capsule-notice' },
        stage,
        el('h2', { id: 'capsule-unseal-title', class: 'dialog-title' }, 'Time capsule opened'),
        el(
          'p',
          { class: 'dialog-text' },
          `Sealed on ${formatShortDate(localISODate(new Date(entry.capsule.sealedAt)))}, to open ${formatShortDate(entry.capsule.openOn)}.`,
        ),
        el('div', { class: 'dialog-actions' }, read),
      ),
    );
    dialog.addEventListener('close', () => finish(false), { once: true });
    showDialog(dialog);
    read.focus();
    playSound('unseal');
  });
}

/**
 * Asks before a sealed letter is opened early. Resolves true when the reader
 * confirms. The seal then ends for good.
 */
export function confirmOpenEarly(entry) {
  return confirmDialog({
    title: 'Open this letter early?',
    message: `It is sealed until ${formatLongDate(entry.capsule.openOn)}. Opening it now ends the seal, and the unsealing will not play.`,
    confirmLabel: 'Open now',
    danger: true,
  });
}

/**
 * An envelope drawn with CSS. `status` is 'sealed' or 'ready'. `unsealing`
 * plays the animation from closed to open. `open` shows the finished state
 * straight away, for reduced motion.
 */
export function capsuleArt(status, { unsealing = false, open = false } = {}) {
  const classes = ['capsule-art', `is-${status}`];
  if (unsealing) classes.push('is-unsealing');
  if (open) classes.push('is-open');
  return el(
    'div',
    { class: classes.join(' '), 'aria-hidden': 'true' },
    el(
      'div',
      { class: 'capsule-envelope' },
      el(
        'div',
        { class: 'capsule-letter' },
        el('span', { class: 'capsule-line' }),
        el('span', { class: 'capsule-line capsule-line-short' }),
        el('span', { class: 'capsule-line' }),
        el('span', { class: 'capsule-line capsule-line-short' }),
      ),
      el('div', { class: 'capsule-front' }),
      el('div', { class: 'capsule-flap' }),
      el('div', { class: 'capsule-seal' }, 'Q'),
    ),
  );
}

/** The envelope and countdown that stand in for a closed entry on a tile. */
export function capsuleTileArt(entry, today = localISODate()) {
  const status = capsuleStatus(entry, today);
  return el(
    'div',
    { class: `capsule-card is-${status}` },
    capsuleArt(status === 'ready' ? 'ready' : 'sealed'),
    el('p', { class: 'capsule-card-text' }, countdownText(entry, today)),
  );
}
