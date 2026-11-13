/**
 * Install, offline, and daily-reminder support. The service worker (sw.js)
 * caches the app shell. This module registers it, catches the browser's install
 * prompt for the File menu, and sends the daily reminder while Quire is open.
 * Entries never leave the device.
 */

import { el } from './dom.js';
import { infoDialog } from './dialogs.js';
import { localISODate } from './model.js';
import { isDesktop } from './desktop.js';

const TAG_PREFIX = 'quire-reminder';
const DEFAULT_TIME = '20:00';
const CHECK_MS = 60 * 1000;

export const REMINDER_DEFAULTS = Object.freeze({ enabled: false, time: DEFAULT_TIME, lastDay: null });

let installPrompt = null;
let installed = false;

function isStandalone() {
  return Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.navigator?.standalone);
}

function isIOS() {
  const nav = globalThis.navigator ?? {};
  return /iPad|iPhone|iPod/.test(nav.userAgent ?? '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

/** 'installed', 'available' (the browser offered its own install prompt), or 'manual' (the user follows the browser's steps). */
export function installState() {
  if (installed || isStandalone() || isDesktop()) return 'installed';
  return installPrompt ? 'available' : 'manual';
}

/** Shows the browser's install prompt. Resolves to 'accepted', 'dismissed', or 'unavailable'. */
export async function promptInstall() {
  if (!installPrompt) return 'unavailable';
  const prompt = installPrompt;
  installPrompt = null;
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === 'accepted') installed = true;
  return outcome;
}

export function showInstallHelp() {
  const steps = isIOS()
    ? ['Open Quire in Safari.', 'Tap the Share button, then Add to Home Screen.', 'Tap Add. Quire opens in its own window.']
    : [
        'Open the browser menu, or use the install icon in the address bar.',
        'Choose Install Quire (or Install app).',
        'Quire opens in its own window and keeps working offline.',
      ];
  infoDialog(
    'Install Quire',
    el(
      'div',
      { class: 'dialog-text' },
      el('p', {}, 'Install Quire to get its own window, a home screen icon, and offline use.'),
      el('ol', { class: 'install-steps' }, steps.map((step) => el('li', {}, step))),
    ),
  );
}

/**
 * Registers the service worker and catches the install prompt. `onReady` runs
 * once, on the first visit, when offline use has been set up.
 */
export function startPwa({ onReady } = {}) {
  globalThis.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
  });
  globalThis.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
  });

  // The desktop shell loads its files from the app bundle, so it needs no service worker.
  if (isDesktop()) return;
  const sw = globalThis.navigator?.serviceWorker;
  if (!sw) return;
  const register = async () => {
    try {
      const firstVisit = !sw.controller;
      await sw.register('sw.js');
      await sw.ready;
      if (firstVisit) onReady?.();
    } catch (error) {
      console.warn('Offline support is unavailable:', error);
    }
  };
  if (document.readyState === 'complete') register();
  else globalThis.addEventListener('load', register, { once: true });
}

function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  return match ? [Number(match[1]), Number(match[2])] : [20, 0];
}

/** True when today's reminder time has passed and it has not gone out yet today. */
export function reminderDue(reminder, now = new Date()) {
  if (!reminder?.enabled) return false;
  const [hours, minutes] = parseTime(reminder.time);
  const due = new Date(now);
  due.setHours(hours, minutes, 0, 0);
  return now >= due && reminder.lastDay !== localISODate(now);
}

/** Shows one notice. `tag` replaces any earlier notice with the same tag, so each one is sent once. */
async function notify(body, tag) {
  const options = {
    body,
    tag,
    icon: 'assets/icon-192.png',
    data: { url: new URL('./', location.href).href },
  };
  const registration = await globalThis.navigator?.serviceWorker?.getRegistration?.();
  if (registration?.showNotification) return registration.showNotification('Quire', options);
  return new globalThis.Notification('Quire', options);
}

/**
 * Checks the reminder once a minute, when the tab returns to the front, and on
 * start. It skips the reminder when an entry already exists for today. It
 * records each day it runs so the reminder sends at most once a day.
 *
 * With reminders on and notifications allowed, `onCapsuleCheck(send)` runs on
 * the same schedule. A time capsule that has arrived gets its notice through
 * `send(body, tag)`. Both only run while Quire is open.
 */
export function startReminders({ getReminder, saveReminder, hasEntryOn, onCapsuleCheck }) {
  let busy = false;
  const check = async () => {
    if (busy) return;
    const reminder = getReminder() ?? REMINDER_DEFAULTS;
    if (globalThis.Notification?.permission !== 'granted') return;
    busy = true;
    try {
      if (reminderDue(reminder)) {
        const today = localISODate();
        const wroteToday = await hasEntryOn(today).catch(() => false);
        if (!wroteToday) await notify('Nothing written yet today. A line is enough.', `${TAG_PREFIX}-${today}`);
        saveReminder({ ...reminder, lastDay: today });
      }
      if (reminder.enabled && onCapsuleCheck) await onCapsuleCheck(notify);
    } catch (error) {
      console.warn('Reminder could not be shown:', error);
    } finally {
      busy = false;
    }
  };
  check();
  setInterval(check, CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check();
  });
}

/**
 * The daily reminder row for the Options dialog's Home tab. `get()` returns the
 * saved prefs and `set(patch)` saves them. `register(refresh)` lets the dialog
 * refresh the row after other changes.
 */
export function reminderRow({ get, set, register }) {
  const hasNotifications = typeof globalThis.Notification !== 'undefined';
  const needsHomeScreen = isIOS() && !isStandalone();
  const unavailable = !hasNotifications || needsHomeScreen;
  const unavailableNote = needsHomeScreen
    ? 'On iPhone and iPad, add Quire to your Home Screen first. Reminders work from that window.'
    : 'This browser cannot show notifications, so the reminder cannot be sent here.';
  const current = () => ({ ...REMINDER_DEFAULTS, ...get().reminder });

  const enabled = el('input', { type: 'checkbox', disabled: unavailable });
  const time = el('input', { type: 'time', 'aria-label': 'Reminder time' });
  const note = el('p', { class: 'options-note', role: 'status' });

  const refresh = () => {
    const reminder = current();
    enabled.checked = Boolean(reminder.enabled);
    time.value = reminder.time || DEFAULT_TIME;
    time.disabled = !reminder.enabled || unavailable;
    if (unavailable) note.textContent = unavailableNote;
    else note.textContent = reminder.enabled
      ? 'Shows while Quire is open. It skips days you already wrote.'
      : 'Turn on to get a nudge at this time on days you have not written yet.';
  };

  enabled.addEventListener('change', async () => {
    if (enabled.checked && globalThis.Notification.permission !== 'granted') {
      const answer = await globalThis.Notification.requestPermission().catch(() => 'denied');
      if (answer !== 'granted') {
        enabled.checked = false;
        note.textContent = 'Notifications are blocked for this site. Allow them in the browser settings, then try again.';
        return;
      }
    }
    set({ reminder: { ...current(), enabled: enabled.checked } });
    refresh();
  });
  time.addEventListener('change', () => {
    if (!time.value) return;
    set({ reminder: { ...current(), time: time.value } });
    refresh();
  });

  register(refresh);
  refresh();
  return el(
    'div',
    { class: 'options-item reminder-item' },
    el('label', { class: 'options-check' }, enabled, el('span', {}, 'Daily reminder')),
    el('label', { class: 'options-time' }, el('span', {}, 'Remind me at'), time),
    note,
  );
}
