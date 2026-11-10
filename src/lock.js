/**
 * Passcode lock screens and the flows that turn the lock on, change it, turn it
 * off, or erase everything. The crypto lives in vault.js and the rows in
 * storage.js; this file only puts the dialogs in front of the user and calls them.
 */

import { el } from './dom.js';
import { confirmDialog, infoDialog, showDialog } from './dialogs.js';
import { icon } from './icons.js';
import { PASSCODE_MAX, changeLock, createLock, passcodeProblem, unlockLock } from './vault.js';

/** Key of the lock record in the store's meta area. Absent means no passcode. */
export const LOCK_META = 'lock';

const WARNING =
  'Quire cannot recover a forgotten passcode. If you forget it, the only way back in is to erase every entry. '
  + 'Backup files are not encrypted, so keep them somewhere safe.';

/**
 * Opens the store for use. With no passcode, it is opened for plain rows.
 * With one, the user types the passcode first and nothing reads until then.
 * Resolves true when the passcode lock is on.
 */
export async function unlockStore(store) {
  const record = await store.getMeta(LOCK_META);
  if (!record) {
    store.setCipher(null);
    return false;
  }
  store.setCipher(await askForPasscode(store, record));
  return true;
}

/** Shows the locked screen until the passcode opens the vault. Escape does nothing here. */
function askForPasscode(store, record) {
  return new Promise((resolve) => {
    const input = el('input', {
      class: 'dialog-input lock-input',
      type: 'password',
      autocomplete: 'current-password',
      'aria-label': 'Passcode',
      required: true,
      maxlength: PASSCODE_MAX,
    });
    const error = el('p', { class: 'dialog-error', role: 'alert' });
    const submit = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Unlock');
    let busy = false;

    const dialog = el(
      'dialog',
      { class: 'dialog lock-dialog' },
      el(
        'form',
        {
          class: 'dialog-form',
          onSubmit: async (event) => {
            event.preventDefault();
            if (busy) return;
            busy = true;
            submit.disabled = true;
            error.textContent = '';
            const vault = await unlockLock(record, input.value);
            if (vault) {
              document.documentElement.classList.remove('is-locked');
              dialog.close();
              resolve(vault);
              return;
            }
            busy = false;
            submit.disabled = false;
            error.textContent = 'That passcode is not right. Try again.';
            input.select();
          },
        },
        el('div', { class: 'lock-head' }, el('span', { class: 'lock-icon', 'aria-hidden': 'true' }, lockIcon()), el('h2', { class: 'dialog-title' }, 'Quire is locked')),
        el('p', { class: 'dialog-text' }, 'Type your passcode to open your entries.'),
        el('label', { class: 'lock-field' }, el('span', {}, 'Passcode'), input),
        error,
        el(
          'div',
          { class: 'dialog-actions split' },
          el('button', { class: 'btn btn-quiet-danger', type: 'button', onClick: () => eraseEverything(store) }, 'Forgot it?'),
          submit,
        ),
      ),
    );
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    // The app shell behind the lock is not in use yet, so the page should not scroll sideways.
    document.documentElement.classList.add('is-locked');
    showDialog(dialog);
    input.focus();
  });
}

function lockIcon() {
  const span = document.createElement('span');
  span.innerHTML = icon('lock');
  return span.firstElementChild;
}

/** The erase path for a forgotten passcode. It is the only way back in, and it removes every entry. */
async function eraseEverything(store) {
  const ok = await confirmDialog({
    title: 'Erase everything?',
    message: 'This removes every entry, version and picture in this browser, and the passcode lock with them. It cannot be undone.',
    confirmLabel: 'Erase everything',
    danger: true,
  });
  if (!ok) return;
  await store.clear();
  location.reload();
}

/**
 * A dialog with passcode fields. `onSubmit(values)` returns an error sentence,
 * or null when it worked and the dialog should close.
 */
function passcodeDialog({ title, text, warning = null, fields, checkbox = null, submitLabel, onSubmit }) {
  const inputs = fields.map((field) => ({
    key: field.key,
    input: el('input', {
      class: 'dialog-input',
      type: 'password',
      autocomplete: field.autocomplete,
      'aria-label': field.label,
      required: true,
      maxlength: PASSCODE_MAX,
    }),
    label: field.label,
  }));
  const check = checkbox ? el('input', { type: 'checkbox', required: true }) : null;
  const error = el('p', { class: 'dialog-error', role: 'alert' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit' }, submitLabel);

  const dialog = el(
    'dialog',
    { class: 'dialog lock-dialog' },
    el(
      'form',
      {
        class: 'dialog-form',
        onSubmit: async (event) => {
          event.preventDefault();
          submit.disabled = true;
          error.textContent = '';
          const values = Object.fromEntries(inputs.map(({ key, input }) => [key, input.value]));
          let problem = null;
          try {
            problem = await onSubmit(values);
          } catch (failure) {
            problem = failure.message || 'Something went wrong. Nothing was changed.';
          }
          if (problem) {
            error.textContent = problem;
            submit.disabled = false;
            inputs[0].input.focus();
            return;
          }
          dialog.close();
        },
      },
      el('h2', { class: 'dialog-title' }, title),
      el('p', { class: 'dialog-text' }, text),
      warning ? el('p', { class: 'dialog-note' }, warning) : null,
      inputs.map(({ input, label }) => el('label', { class: 'lock-field' }, el('span', {}, label), input)),
      check ? el('label', { class: 'lock-check' }, check, el('span', {}, checkbox)) : null,
      error,
      el(
        'div',
        { class: 'dialog-actions' },
        el('button', { class: 'btn', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
        submit,
      ),
    ),
  );
  showDialog(dialog);
  inputs[0].input.focus();
  return dialog;
}

function checkMatch(passcode, confirm) {
  if (passcode !== confirm) return 'The two passcodes do not match.';
  return passcodeProblem(passcode);
}

/** Turns the lock on: a new passcode, then every row sealed under it. */
function setupLock({ store, flush, status, setOn }) {
  passcodeDialog({
    title: 'Turn on passcode lock',
    text: 'Quire will ask for this passcode each time it opens. Entries, their versions and their pictures are encrypted in this browser while the lock is on.',
    warning: WARNING,
    fields: [
      { key: 'passcode', label: 'New passcode', autocomplete: 'new-password' },
      { key: 'confirm', label: 'Type it again', autocomplete: 'new-password' },
    ],
    checkbox: 'I understand that a forgotten passcode cannot be recovered.',
    submitLabel: 'Turn on',
    onSubmit: async ({ passcode, confirm }) => {
      const problem = checkMatch(passcode, confirm);
      if (problem) return problem;
      await flush();
      const { record, vault } = await createLock(passcode);
      // The record goes in first. If the run is interrupted, the lock is on, and the rows still open.
      await store.setMeta(LOCK_META, record);
      await store.reseal(vault);
      setOn(true);
      status('Passcode lock is on. Entries are encrypted in this browser.');
      return null;
    },
  });
}

function changePasscode({ store, flush, status }) {
  passcodeDialog({
    title: 'Change passcode',
    text: 'Type the current passcode, then the new one. Your entries stay as they are.',
    fields: [
      { key: 'current', label: 'Current passcode', autocomplete: 'current-password' },
      { key: 'passcode', label: 'New passcode', autocomplete: 'new-password' },
      { key: 'confirm', label: 'Type it again', autocomplete: 'new-password' },
    ],
    submitLabel: 'Change',
    onSubmit: async ({ current, passcode, confirm }) => {
      const record = await store.getMeta(LOCK_META);
      const vault = await unlockLock(record, current);
      if (!vault) return 'That is not your current passcode.';
      const problem = checkMatch(passcode, confirm);
      if (problem) return problem;
      await flush();
      await store.setMeta(LOCK_META, await changeLock(vault, passcode));
      status('Passcode changed.');
      return null;
    },
  });
}

function turnOffLock({ store, flush, status, setOn }) {
  passcodeDialog({
    title: 'Turn off passcode lock',
    text: 'Entries will be stored without encryption again, so anyone who can open this browser profile can read them. Type the current passcode to confirm.',
    fields: [{ key: 'current', label: 'Current passcode', autocomplete: 'current-password' }],
    submitLabel: 'Turn off',
    onSubmit: async ({ current }) => {
      const record = await store.getMeta(LOCK_META);
      if (!(await unlockLock(record, current))) return 'That is not your current passcode.';
      await flush();
      await store.reseal(null);
      await store.removeMeta(LOCK_META);
      setOn(false);
      status('Passcode lock is off.');
      return null;
    },
  });
}

/**
 * File > Passcode lock. Without a passcode it offers to turn one on. With one
 * it offers to change it, turn it off, or lock now. `ctx` is { store, flush,
 * status, setOn }; setOn(boolean) reports the lock state after a change.
 * Resolves to the lock state when the dialog opened.
 */
export async function openPasscodeSettings(ctx) {
  const { store } = ctx;
  if (store.kind !== 'indexeddb') {
    infoDialog(
      'Passcode lock',
      el('p', { class: 'dialog-text' }, 'The passcode lock needs browser storage, and this browser has none. Entries would not survive a reload, so the lock is unavailable.'),
    );
    return false;
  }
  const on = Boolean(await store.getMeta(LOCK_META));
  if (!on) {
    setupLock(ctx);
    return false;
  }
  const dialog = el(
    'dialog',
    { class: 'dialog' },
    el(
      'form',
      { method: 'dialog', class: 'dialog-form' },
      el('h2', { class: 'dialog-title' }, 'Passcode lock'),
      el('p', { class: 'dialog-text' }, 'The passcode lock is on. Entries are encrypted in this browser and open only after you type the passcode.'),
      el(
        'div',
        { class: 'dialog-actions lock-actions' },
        el('button', { class: 'btn', type: 'submit', value: 'off' }, 'Turn off…'),
        el('button', { class: 'btn', type: 'submit', value: 'lock' }, 'Lock now'),
        el('button', { class: 'btn btn-primary', type: 'submit', value: 'change' }, 'Change passcode…'),
      ),
    ),
  );
  dialog.addEventListener('close', () => {
    const choice = dialog.returnValue;
    if (choice === 'change') changePasscode(ctx);
    if (choice === 'off') turnOffLock(ctx);
    if (choice === 'lock') lockNow(ctx.flush);
  }, { once: true });
  showDialog(dialog);
  return true;
}

/** Saves what is open, then reloads. The reload drops the key from memory and shows the lock screen. */
export async function lockNow(flush) {
  await flush();
  location.reload();
}
