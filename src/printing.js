/**
 * The Print dialog (File > Print, Ctrl+P). A Vista property sheet on the left
 * picks what to print, which entries, and the page. The right side previews the
 * job as it will print. Print sends the same HTML to a hidden frame, so the
 * browser's own print dialog and print preview take over from there.
 *
 * The choices are remembered in prefs, so the next print opens the same way.
 */

import { el } from './dom.js';
import { showDialog } from './dialogs.js';
import { renderInkCanvas } from './drawing.js';
import { inkHeightFor } from './export.js';
import { loadPrefs, savePrefs } from './prefs.js';
import { localISODate } from './model.js';
import {
  DEFAULT_PAGE,
  MARGINS,
  PAPERS,
  buildPrintJob,
  kindById,
  notebooksIn,
  optionsFor,
  pageSetup,
  printKinds,
  selectEntries,
} from './print-docs.js';

const PREVIEW_PAD = 28;

/**
 * A PNG of an entry's drawing on its page color, cached while the entry is unchanged.
 * `plain` renders on white instead, for drawings laid over the text (multiplied onto the sheet).
 */
function makeInkUrl() {
  const cache = new Map();
  return (entry, { plain = false } = {}) => {
    const normHeight = inkHeightFor(entry);
    const base = plain ? '#ffffff' : entry.pageColor;
    const key = `${entry.id}|${entry.updatedAt}|${base}|${entry.ink.ops.length}|${normHeight}`;
    if (!cache.has(key)) {
      const canvas = renderInkCanvas(entry.ink.ops, { pageColor: base, layers: entry.ink.layers, pixelWidth: 1640, normHeight });
      cache.set(key, canvas.toDataURL('image/png'));
    }
    return cache.get(key);
  };
}

/** A radio group. `onPick` runs when the user picks one. Items may be disabled. */
function radioGroup(name, items, value, onPick) {
  const inputs = items.map((item) => {
    const input = el('input', { type: 'radio', name, value: item.id, onChange: () => onPick(item.id) });
    input.checked = item.id === value;
    input.disabled = Boolean(item.disabled);
    return { input, node: el('label', { class: 'options-radio' }, input, el('span', {}, item.label)) };
  });
  return {
    nodes: inputs.map((entry) => entry.node),
    checked: () => inputs.find(({ input }) => input.checked)?.input ?? null,
    set(next) {
      for (const { input } of inputs) input.checked = input.value === next;
    },
  };
}

function checkBox(label, checked, onChange) {
  const input = el('input', { type: 'checkbox', onChange: () => onChange(input.checked) });
  input.checked = Boolean(checked);
  return { input, node: el('label', { class: 'options-check' }, input, el('span', {}, label)) };
}

/** Opens the Print dialog. `entries` is the whole library, with the open entry already swapped in as `current`. */
export function openPrintDialog({ entries, current = null, fontStack, stylesheet }) {
  const today = localISODate();
  const kinds = printKinds();
  const notebooks = notebooksIn(entries);
  const inkUrl = makeInkUrl();

  const saved = loadPrefs().printSettings ?? {};
  // Open on the saved kind, unless it needs an open entry and none is open.
  const savedKind = kindById(saved.kind);
  const startKind = savedKind && !(savedKind.scope === 'current' && !current) ? savedKind.id : current ? 'entry' : 'log';

  const state = {
    kind: startKind,
    notebook: notebooks.includes(saved.notebook) ? saved.notebook : '',
    from: typeof saved.from === 'string' ? saved.from : '',
    to: typeof saved.to === 'string' ? saved.to : '',
    options: saved.options && typeof saved.options === 'object' ? saved.options : {},
    page: { ...DEFAULT_PAGE, ...(saved.page ?? {}) },
    // Until the user types a header, it follows the kind (Journal log, Drawings, Stats).
    headerTouched: Boolean(saved.headerTouched),
  };
  const headerFor = () => (state.headerTouched ? state.page.header : kindById(state.kind)?.defaultHeader ?? '');

  // ---------- the property sheet ----------

  const kindRadios = radioGroup(
    'print-kind',
    kinds.map((kind) => ({ id: kind.id, label: kind.label, disabled: kind.scope === 'current' && !current })),
    state.kind,
    (id) => {
      state.kind = id;
      renderKindOptions();
      headerInput.value = headerFor();
      update();
    },
  );

  const notebookSelect = el(
    'select',
    {
      class: 'dialog-select print-notebook',
      'aria-label': 'Notebook',
      onChange: () => {
        state.notebook = notebookSelect.value;
        update();
      },
    },
    el('option', { value: '' }, 'All notebooks'),
    notebooks.map((name) => el('option', { value: name }, name)),
  );
  notebookSelect.value = state.notebook;

  const dateField = (label, key) => {
    const input = el('input', {
      type: 'date',
      class: 'dialog-input print-date',
      'aria-label': `${label} date`,
      onChange: () => {
        state[key] = input.value;
        update();
      },
    });
    input.value = state[key];
    return el('label', { class: 'options-field' }, el('span', {}, label), input);
  };

  const countNote = el('p', { class: 'options-note options-note-first', 'aria-live': 'polite' });
  const entriesGroup = el(
    'fieldset',
    { class: 'options-group print-entries' },
    el('legend', { class: 'options-legend' }, 'Entries'),
    el('p', { class: 'options-note options-note-first' }, 'Empty dates mean no limit. The sample entry is never printed in a group.'),
    el('label', { class: 'options-field' }, el('span', {}, 'Notebook'), notebookSelect),
    dateField('From', 'from'),
    dateField('To', 'to'),
    countNote,
  );

  const optionsBox = el('div', { class: 'print-kind-options' });
  const optionsGroup = el('fieldset', { class: 'options-group' }, el('legend', { class: 'options-legend' }, 'Options'), optionsBox);

  function renderKindOptions() {
    const kind = kindById(state.kind);
    const values = optionsFor(kind, state.options[kind.id]);
    state.options[kind.id] = values;
    const boxes = (kind.options ?? []).map((option) =>
      checkBox(option.label, values[option.id], (on) => {
        state.options[kind.id] = { ...state.options[kind.id], [option.id]: on };
        update();
      }).node,
    );
    optionsBox.replaceChildren(...(boxes.length ? boxes : [el('p', { class: 'options-note options-note-first' }, 'This kind has no options.')]));
    // Notebook and date limits do not apply to a single entry.
    entriesGroup.disabled = kind.scope === 'current';
  }

  const paperSelect = el(
    'select',
    {
      class: 'dialog-select print-paper',
      'aria-label': 'Paper size',
      onChange: () => {
        state.page.paper = paperSelect.value;
        update();
      },
    },
    PAPERS.map((paper) => el('option', { value: paper.id }, paper.label)),
  );
  paperSelect.value = state.page.paper;

  const orientation = radioGroup(
    'print-orientation',
    [
      { id: 'portrait', label: 'Portrait' },
      { id: 'landscape', label: 'Landscape' },
    ],
    state.page.orientation,
    (id) => {
      state.page.orientation = id;
      update();
    },
  );
  const margins = radioGroup('print-margin', MARGINS, state.page.margin, (id) => {
    state.page.margin = id;
    update();
  });

  const headerInput = el('input', {
    type: 'text',
    class: 'dialog-input print-header',
    maxlength: '120',
    placeholder: 'No header',
    'aria-label': 'Header text',
    onInput: () => {
      state.page.header = headerInput.value;
      state.headerTouched = true;
      update();
    },
  });
  headerInput.value = headerFor();

  const printDate = checkBox('Print the date (bottom left)', state.page.printDate, (on) => {
    state.page.printDate = on;
    update();
  });
  const pageNumbers = checkBox('Page numbers (bottom right)', state.page.pageNumbers, (on) => {
    state.page.pageNumbers = on;
    update();
  });

  const pageGroup = el(
    'fieldset',
    { class: 'options-group' },
    el('legend', { class: 'options-legend' }, 'Page'),
    el('label', { class: 'options-field' }, el('span', {}, 'Paper'), paperSelect),
    el('div', { class: 'options-item print-row' }, el('span', { class: 'print-sub' }, 'Orientation'), orientation.nodes),
    el('div', { class: 'options-item print-row' }, el('span', { class: 'print-sub' }, 'Margins'), margins.nodes),
    el('label', { class: 'options-field' }, el('span', {}, 'Header'), headerInput),
    el('div', { class: 'options-item' }, printDate.node, pageNumbers.node),
  );

  // ---------- the preview ----------

  const frame = el('iframe', { class: 'print-frame', title: 'Print preview', tabindex: '-1' });
  const stage = el('div', { class: 'print-stage' }, frame);
  const previewStatus = el('p', { class: 'print-status', 'aria-live': 'polite' });
  const printButton = el('button', { class: 'btn btn-primary', type: 'button', onClick: () => printNow() }, 'Print');
  let frameHeight = 0;

  /** Scales the paper-sized frame to fit the preview pane, and sizes the stage to match. */
  function fitPreview() {
    const setup = pageSetup(state.page);
    const pane = stage.parentElement;
    const available = Math.max(160, (pane?.clientWidth ?? setup.widthPx) - PREVIEW_PAD * 2);
    const scale = Math.min(1, available / setup.widthPx);
    const height = frameHeight || setup.heightPx;
    frame.style.width = `${Math.round(setup.widthPx)}px`;
    frame.style.height = `${Math.round(height)}px`;
    frame.style.transform = `scale(${scale})`;
    stage.style.width = `${Math.round(setup.widthPx * scale)}px`;
    stage.style.height = `${Math.round(height * scale)}px`;
  }

  frame.addEventListener('load', () => {
    frameHeight = frame.contentDocument?.documentElement.scrollHeight ?? 0;
    fitPreview();
  });

  function buildCurrentJob() {
    const kind = kindById(state.kind);
    const scoped = kind.scope === 'current' ? (current ? [current] : []) : selectEntries(entries, state);
    const job = buildPrintJob({
      kindId: state.kind,
      entries: scoped,
      options: state.options[state.kind],
      page: { ...state.page, header: headerFor() },
      range: { from: state.from, to: state.to },
      today,
      fontStack,
      stylesheet,
      inkUrl,
    });
    return { kind, scoped, job };
  }

  let previewTimer = 0;
  /** Updates the notes and the preview. The preview waits briefly, so typing does not rebuild it on every key. */
  function update() {
    savePrefs({
      printSettings: {
        kind: state.kind,
        notebook: state.notebook,
        from: state.from,
        to: state.to,
        options: state.options,
        page: state.page,
        headerTouched: state.headerTouched,
      },
    });
    const { kind, scoped, job } = buildCurrentJob();
    countNote.textContent = kind.scope === 'current' ? '' : `${scoped.length} ${scoped.length === 1 ? 'entry' : 'entries'} selected.`;
    previewStatus.textContent = job.empty ? 'Nothing to print with these settings.' : `${kind.label}, ${state.page.paper.toUpperCase()}`;
    printButton.disabled = job.empty;
    fitPreview();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      frame.srcdoc = job.html;
    }, 90);
  }

  function printNow() {
    const { job } = buildCurrentJob();
    if (job.empty) return;
    printHtml(job.html);
    dialog.close();
  }

  const dialog = el(
    'dialog',
    { class: 'dialog print-dialog', 'aria-labelledby': 'print-heading' },
    el(
      'form',
      { method: 'dialog', class: 'dialog-form print-form' },
      el('h2', { id: 'print-heading', class: 'dialog-title' }, 'Print'),
      el(
        'div',
        { class: 'print-body' },
        el('div', { class: 'print-controls' }, el('fieldset', { class: 'options-group' }, el('legend', { class: 'options-legend' }, 'Print what'), kindRadios.nodes), entriesGroup, optionsGroup, pageGroup),
        el('div', { class: 'print-preview-pane' }, el('p', { class: 'print-preview-label' }, 'Preview'), stage, previewStatus),
      ),
      el('p', { class: 'dialog-note' }, 'Page breaks and the header and footer are final in the browser’s own print preview.'),
      el('div', { class: 'dialog-actions print-actions' }, el('button', { class: 'btn', type: 'submit', value: 'cancel' }, 'Cancel'), printButton),
    ),
  );

  const onResize = () => fitPreview();
  window.addEventListener('resize', onResize);
  dialog.addEventListener('close', () => window.removeEventListener('resize', onResize), { once: true });

  renderKindOptions();
  showDialog(dialog);
  kindRadios.checked()?.focus();
  update();
  return dialog;
}

/** Prints an HTML document through a hidden frame, so the page itself stays put. */
export function printHtml(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('title', 'Print');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  frame.addEventListener(
    'load',
    async () => {
      const win = frame.contentWindow;
      await Promise.all([...win.document.images].map((img) => img.decode().catch(() => {})));
      if (win.document.fonts?.ready) await win.document.fonts.ready;
      win.focus();
      win.print();
      setTimeout(() => frame.remove(), 1500);
    },
    { once: true },
  );
  frame.srcdoc = html;
  document.body.append(frame);
}
