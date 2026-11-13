/**
 * Desktop controller: the app's side of the native shell. It takes tray,
 * shortcut and file-open intents, keeps the launch and tray settings in step
 * with the shell, and offers an update when a newer release is out. Mixed into
 * QuireApp. Everything here is a no-op in the browser.
 *
 * `startDesktop()` runs only after the store is unlocked, so an intent that
 * arrives while the passcode screen is up waits in the shell's queue and
 * never writes an entry past the lock.
 */

import { confirmDialog } from '../dialogs.js';
import { localISODate } from '../model.js';
import { desktopShell, isDesktop } from '../desktop.js';
import {
  DOWNLOAD_URL,
  RELEASES_API,
  baseName,
  invokeShell,
  normalizeIntent,
  openKind,
  shouldCheckUpdate,
  updateNotice,
} from '../desktop-integration.js';

export const desktopMethods = {
  /** Connects to the shell once the library is open. Does nothing in the browser. */
  async startDesktop() {
    if (!isDesktop()) return;
    globalThis.addEventListener('quire:intent', (event) => {
      this.handleShellIntent(event.detail).catch((error) => this.showStatus(`Quire could not do that: ${error.message}`, true));
    });
    await this.applyShellSettings();
    const queued = (await invokeShell('plugin:quire-intents|take')) ?? [];
    for (const raw of queued) await this.handleShellIntent(raw);
    this.checkForDesktopUpdate().catch((error) => console.warn('Update check failed:', error));
  },

  /** Writes the launch-at-login and tray settings to the shell. Called at start and after each change. */
  async applyShellSettings() {
    if (!isDesktop()) return;
    await invokeShell('plugin:quire-autostart|set_enabled', { enabled: Boolean(this.prefs.launchAtLogin) });
    await invokeShell('plugin:quire-tray|set_enabled', { enabled: this.prefs.trayIcon === true });
  },

  async handleShellIntent(raw) {
    const intent = normalizeIntent(raw);
    if (!intent) return;
    if (intent.name === 'new-entry') return this.newEntry();
    if (intent.name === 'quick-note') return this.newEntry({ kind: 'note' });
    return this.openShellFile(intent.path);
  },

  /** Opens a file the user double-clicked: a backup restores, and a journal export imports. */
  async openShellFile(path) {
    const name = baseName(path);
    const kind = openKind(name);
    if (!kind) {
      this.showStatus(`Quire cannot open ${name || 'that file'}. Choose a Quire backup, a Day One export, or Markdown.`, true);
      return;
    }
    const text = await invokeShell('plugin:quire-files|read_text', { path });
    if (typeof text !== 'string') {
      this.showStatus(`Quire could not read ${name}.`, true);
      return;
    }
    const file = { name, text: async () => text };
    if (kind === 'restore') return this.restoreFrom(file);
    return this.importFiles([file]);
  },

  /**
   * Asks GitHub for the latest release, at most once a day. A newer one gets a
   * dialog with a download link. "Later" waits for the next release, and the
   * shell never installs anything, because the build is not signed.
   */
  async checkForDesktopUpdate() {
    const today = localISODate();
    if (!shouldCheckUpdate(this.prefs.updateCheckDay, today)) return;
    this.setPref({ updateCheckDay: today });
    const release = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    const notice = updateNotice(release, desktopShell()?.version);
    if (!notice || notice.version === this.prefs.dismissedUpdate) return;
    const download = await confirmDialog({
      title: `Quire ${notice.version} is out`,
      message: 'A newer version of Quire is ready. Download the installer from the release page. Your entries stay on this computer.',
      confirmLabel: 'Download',
    });
    if (download) globalThis.open(DOWNLOAD_URL, '_blank', 'noopener');
    else this.setPref({ dismissedUpdate: notice.version });
  },
};
