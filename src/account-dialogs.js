/**
 * The account dialogs: sign in or create an account, see the account, sync now,
 * and use the account's passcode on a new device. They reuse the dialog classes
 * the rest of the app uses, so every skin and both light and dark modes apply.
 * The logic lives in src/cloud/account.js; this file only shows it.
 */

import { el } from './dom.js';
import { confirmDialog, infoDialog, showDialog } from './dialogs.js';
import {
  NeedsAccountPasscode,
  NeedsPasscodeSetup,
  accountState,
  adoptAccountPasscode,
  createAccountWithPassword,
  finishSignInFromUrl,
  googleSignInUrl,
  sendMagicLink,
  signInWithPassword,
  signOut,
  syncNow,
} from './cloud/account.js';
import { cloudConfigured } from './cloud/config.js';

const SYNC_SCOPE = 'Entries, their pictures, sketches and voice notes, and the desk drawer. Versions, settings and the sticky note stay on this device for now.';

function field(label, input) {
  return el('label', { class: 'lock-field' }, el('span', {}, label), input);
}

function textInput(attrs) {
  return el('input', { class: 'dialog-input', required: true, ...attrs });
}

function describe(summary) {
  const parts = [`${summary.pushed} sent`, `${summary.pulled} received`];
  if (summary.conflicts) parts.push(`${summary.conflicts} kept in version history`);
  return `Synced: ${parts.join(', ')}.`;
}

/**
 * Runs a sync pass and shows the result. When this device lacks the account's
 * passcode, it asks for it. `ctx` is { store, status(text, isError), lockOn,
 * openPasscode(), onLockChanged(on) }.
 */
export async function runSync(ctx) {
  try {
    const summary = await syncNow(ctx.store);
    ctx.status(describe(summary));
    return true;
  } catch (error) {
    if (error instanceof NeedsAccountPasscode) {
      askForAccountPasscode(ctx, error.remoteKey);
      return false;
    }
    ctx.status(error instanceof NeedsPasscodeSetup ? error.message : (error.message || 'Sync did not finish. Your entries are safe on this device.'), true);
    return false;
  }
}

/** Asks for the account's passcode, then re-encrypts this device's entries with it and syncs. */
function askForAccountPasscode(ctx, remoteKey) {
  const input = textInput({ type: 'password', autocomplete: 'current-password', 'aria-label': 'Account passcode' });
  const error = el('p', { class: 'dialog-error', role: 'alert' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Use this passcode');
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
          let ok = false;
          try {
            ok = await adoptAccountPasscode(ctx.store, remoteKey, input.value);
          } catch (failure) {
            error.textContent = failure.message || 'Nothing was changed. Try again.';
            submit.disabled = false;
            return;
          }
          if (!ok) {
            error.textContent = 'That is not your account passcode.';
            submit.disabled = false;
            input.select();
            return;
          }
          ctx.onLockChanged(true);
          dialog.close();
          ctx.status('This device now uses your account passcode. Syncing…');
          await runSync(ctx);
        },
      },
      el('h2', { class: 'dialog-title' }, 'Use your account passcode'),
      el(
        'p',
        { class: 'dialog-text' },
        'Your account already has a passcode lock from another device. Type that passcode here. Entries on this device are re-encrypted with it, so every device can read them.',
      ),
      field('Account passcode', input),
      error,
      el('div', { class: 'dialog-actions' }, el('button', { class: 'btn', type: 'button', onClick: () => dialog.close() }, 'Cancel'), submit),
    ),
  );
  showDialog(dialog);
  input.focus();
}

function signedInDialog(ctx, state) {
  const status = el('p', { class: 'dialog-error', role: 'status' });
  const sync = el('button', { class: 'btn btn-primary', type: 'button' }, 'Sync now');
  const out = el('button', { class: 'btn', type: 'button' }, 'Sign out…');
  const dialog = el(
    'dialog',
    { class: 'dialog account-dialog' },
    el(
      'div',
      { class: 'dialog-form' },
      el('h2', { class: 'dialog-title' }, 'Account and sync'),
      el('p', { class: 'dialog-text' }, `Signed in as ${state.email}.`),
      el('p', { class: 'dialog-text' }, state.syncedAt ? `Last synced ${new Date(state.syncedAt).toLocaleString()}.` : 'Not synced yet.'),
      el('p', { class: 'dialog-note' }, SYNC_SCOPE),
      status,
      el('div', { class: 'dialog-actions split' }, out, el('div', { class: 'dialog-actions' }, el('button', { class: 'btn', type: 'button', onClick: () => dialog.close() }, 'Close'), sync)),
    ),
  );
  sync.addEventListener('click', async () => {
    sync.disabled = true;
    status.textContent = 'Syncing…';
    const ok = await runSync({ ...ctx, status: (text, isError = false) => { status.textContent = text; status.classList.toggle('is-error', isError); } });
    sync.disabled = false;
    if (ok) ctx.onSynced?.();
  });
  out.addEventListener('click', async () => {
    const yes = await confirmDialog({
      title: 'Sign out?',
      message: 'Your entries stay on this device. Sync stops until you sign in again.',
      confirmLabel: 'Sign out',
    });
    if (!yes) return;
    await signOut(ctx.store);
    dialog.close();
    ctx.status('Signed out. Entries stay on this device.');
  });
  return dialog;
}

function signedOutDialog(ctx) {
  let signInButton = null;
  const email = textInput({ type: 'email', autocomplete: 'email', 'aria-label': 'Email', placeholder: 'you@example.com' });
  const password = textInput({ type: 'password', autocomplete: 'current-password', 'aria-label': 'Password', minlength: 8 });
  const error = el('p', { class: 'dialog-error', role: 'alert' });
  const busy = [];
  const run = (button, task) => async () => {
    error.textContent = '';
    busy.forEach((other) => { other.disabled = true; });
    try {
      await task();
    } catch (failure) {
      error.textContent = failure.message || 'Something went wrong. Nothing was changed.';
    } finally {
      busy.forEach((other) => { other.disabled = false; });
    }
  };
  const button = (label, attrs, onClick) => {
    const node = el('button', { class: 'btn', type: 'button', ...attrs }, label);
    node.addEventListener('click', onClick);
    busy.push(node);
    return node;
  };
  const needEmail = () => {
    if (!email.value.trim()) throw new Error('Type your email first.');
    return email.value.trim();
  };
  const dialog = el(
    'dialog',
    { class: 'dialog account-dialog' },
    el(
      'form',
      {
        class: 'dialog-form',
        onSubmit: (event) => {
          event.preventDefault();
          signInButton.click();
        },
      },
      el('h2', { class: 'dialog-title' }, 'Account and sync'),
      el('p', { class: 'dialog-text' }, 'Sign in to keep your entries in step across devices. Quire works fully without an account.'),
      el('p', { class: 'dialog-note' }, 'Entries are encrypted in this browser before they are sent, so the server only holds ciphertext. Sync needs the passcode lock on.'),
      ctx.lockOn
        ? null
        : el(
          'div',
          { class: 'account-lock-note' },
          el('p', { class: 'dialog-text' }, 'The passcode lock is off. Turn it on first; sync uses it to encrypt your entries.'),
          el('button', { class: 'btn', type: 'button', onClick: () => { dialog.close(); ctx.openPasscode(); } }, 'Turn on passcode lock…'),
        ),
      el('button', { class: 'btn btn-primary account-google', type: 'button', onClick: run('google', async () => { location.assign(await googleSignInUrl()); }) }, 'Continue with Google'),
      field('Email', email),
      field('Password', password),
      error,
      el(
        'div',
        { class: 'dialog-actions split' },
        button('Email me a link', {}, run('link', async () => {
          await sendMagicLink({ email: needEmail() });
          ctx.status('Check your email for a sign-in link. Open it in this browser.');
          dialog.close();
        })),
        el(
          'div',
          { class: 'dialog-actions' },
          button('Create account', {}, run('create', async () => {
            const { needsConfirmation } = await createAccountWithPassword(ctx.store, { email: needEmail(), password: password.value });
            dialog.close();
            if (needsConfirmation) {
              ctx.status('Check your email to confirm your account, then sign in.');
              return;
            }
            ctx.status('Account created. Syncing…');
            await runSync(ctx);
          })),
          (signInButton = button('Sign in', { type: 'submit' }, run('sign-in', async () => {
            await signInWithPassword(ctx.store, { email: needEmail(), password: password.value });
            dialog.close();
            ctx.status('Signed in. Syncing…');
            await runSync(ctx);
          }))),
        ),
      ),
    ),
  );
  return dialog;
}

/** The File menu's account entry. `ctx` is { store, status(text, isError), lockOn, openPasscode(), onLockChanged(on), onSynced() }. */
export async function openAccountDialog(ctx) {
  if (!cloudConfigured()) {
    infoDialog('Account and sync', el('p', { class: 'dialog-text' }, 'Accounts are not set up in this build yet. Quire works fully without one.'));
    return;
  }
  if (ctx.store.kind !== 'indexeddb') {
    infoDialog('Account and sync', el('p', { class: 'dialog-text' }, 'Sync needs browser storage, and this browser has none.'));
    return;
  }
  const state = await accountState(ctx.store);
  showDialog(state.signedIn ? signedInDialog(ctx, state) : signedOutDialog(ctx));
}

/** Picks up a sign-in that came back from Google or an email link. Resolves the result for the caller to show. */
export async function completeSignInRedirect(ctx) {
  const result = await finishSignInFromUrl(ctx.store);
  if (!result) return null;
  if (result.error) {
    ctx.status(result.error, true);
    return result;
  }
  ctx.status('Signed in. Syncing…');
  await runSync(ctx);
  return result;
}
