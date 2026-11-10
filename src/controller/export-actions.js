/** Export, backup, and restore actions for the Quire controller: Markdown and drawing exports, print to PDF, and whole-library backup and restore. Mixed into QuireApp. */

import { FONT_STACKS } from './constants.js';
import { el } from '../dom.js';
import {
  downloadBlob,
  exportDrawingPng,
  exportMarkdown,
  makeBackup,
  parseBackup,
  printEntry,
} from '../export.js';
import { openPasscodeSettings } from '../lock.js';
import { localISODate } from '../model.js';
import { installState, promptInstall, showInstallHelp } from '../pwa.js';
import { playSound } from '../sound.js';
import { MAX_VERSIONS } from '../versions.js';

export const exportMethods = {
  // ---------- export, backup, restore ----------

  async exportMarkdown() {
    if (!this.entry) return;
    await exportMarkdown(this.snapshot());
    this.showStatus('Exported Markdown');
    playSound('export');
  },

  async exportDrawing() {
    if (!this.entry) return;
    if (this.drawing.isEmpty) {
      this.showStatus('Nothing drawn yet');
      return;
    }
    await exportDrawingPng(this.snapshot());
    this.showStatus('Exported drawing');
    playSound('export');
  },

  printPdf() {
    if (!this.entry) return;
    printEntry(this.snapshot(), { fontStack: FONT_STACKS[this.prefs.font] ?? FONT_STACKS.serif });
  },

  /** Uses the browser's install prompt when it offered one. Otherwise it explains the browser's own steps. */
  async installQuire() {
    if (installState() !== 'available') {
      showInstallHelp();
      return;
    }
    if ((await promptInstall()) === 'accepted') this.showStatus('Quire is installing…', false, 'saved');
  },

  async passcodeSettings() {
    await openPasscodeSettings({
      store: this.store,
      flush: () => this.persist(),
      status: (text) => this.showStatus(text),
      setOn: (on) => {
        this.passcodeOn = on;
      },
    });
  },

  async backup() {
    await this.persist();
    const entries = await this.store.listFull();
    const versions = await this.store.listAllVersions();
    downloadBlob(makeBackup(entries, versions), `quire-backup-${localISODate()}.json`);
    this.showStatus(`Backed up ${entries.length} entries and ${versions.length} versions`);
  },

  restore() {
    const input = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (file) await this.restoreFrom(file);
    });
    document.body.append(input);
    input.click();
  },

  async restoreFrom(file) {
    const { entries, versions } = parseBackup(await file.text());
    await this.persist();
    // Drop the in-memory entry first, so a stale copy cannot overwrite the restored one.
    this.entry = null;
    for (const entry of entries) await this.store.save(entry);
    // Only versions whose entry is in this backup are restored. Same ids overwrite, so restoring twice adds nothing.
    const restored = new Set(entries.map((entry) => entry.id));
    const usable = versions.filter((version) => restored.has(version.entryId));
    for (const version of usable) await this.store.saveVersion(version, MAX_VERSIONS);
    await this.showHome();
    this.showStatus(`Restored ${entries.length} entries and ${usable.length} versions`);
  },
};
