/** Export, print, backup, and restore actions for the Quire controller: Markdown and drawing exports, the Print dialog, and whole-library backup and restore. Mixed into QuireApp. */

import { FONT_STACKS } from './constants.js';
import { el } from '../dom.js';
import {
  downloadBlob,
  exportDrawingPng,
  exportMarkdown,
  makeBackup,
  parseBackup,
} from '../export.js';
import { openPrintDialog } from '../printing.js';
import { openPasscodeSettings } from '../lock.js';
import { localISODate } from '../model.js';
import { installState, promptInstall, showInstallHelp } from '../pwa.js';
import { playSound } from '../sound.js';
import { postcardDialog } from '../postcard.js';
import { MAX_VERSIONS } from '../versions.js';
import { parseImportFile } from '../import.js';

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

  /** Opens the postcard dialog for the open entry. Saving or sharing happens inside it. */
  async postcard() {
    if (!this.entry) return;
    await postcardDialog(this.snapshot(), { onStatus: (text) => this.showStatus(text) });
  },

  /** File > Print. The dialog reads the whole library, with the open entry's unsaved text swapped in. */
  async printPdf() {
    await this.persist();
    const current = this.entry ? this.snapshot() : null;
    const saved = await this.store.listFull();
    const entries = current ? saved.map((entry) => (entry.id === current.id ? current : entry)) : saved;
    openPrintDialog({
      entries,
      current,
      fontStack: FONT_STACKS[this.prefs.font] ?? FONT_STACKS.serif,
      stylesheet: new URL('../../styles/reader.css', import.meta.url).href,
    });
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

  /** Picks Day One JSON or Markdown files. Entries that already exist are left alone, so importing twice adds nothing. */
  importEntries() {
    const input = el('input', { type: 'file', accept: '.json,.md,.markdown,.txt,application/json,text/markdown,text/plain', multiple: true, hidden: true });
    input.addEventListener('change', async () => {
      const files = [...(input.files ?? [])];
      input.remove();
      if (files.length) await this.importFiles(files);
    });
    document.body.append(input);
    input.click();
  },

  async importFiles(files) {
    await this.persist();
    const today = localISODate();
    let added = 0;
    let existing = 0;
    let skipped = 0;
    const problems = [];
    for (const file of files) {
      let parsed;
      try {
        parsed = parseImportFile(file.name, await file.text(), today);
      } catch (error) {
        problems.push(`${file.name}: ${error.message}`);
        continue;
      }
      skipped += parsed.skipped;
      for (const entry of parsed.entries) {
        if (await this.store.get(entry.id)) {
          existing += 1;
          continue;
        }
        await this.store.save(entry);
        added += 1;
      }
    }
    await this.showHome();
    const parts = [`Imported ${added} ${added === 1 ? 'entry' : 'entries'}`];
    if (existing) parts.push(`${existing} already here`);
    if (skipped) parts.push(`${skipped} without a date`);
    if (problems.length) parts.push(problems.join('; '));
    this.showStatus(`${parts.join(', ')}.`, Boolean(problems.length));
  },
};
