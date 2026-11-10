/** Time capsule actions for the Quire controller: sealing the open entry, changing or breaking a seal, and the arrival notice. Mixed into QuireApp. */

import { capsuleStatus, rescheduledEntry, sealedEntry, unsealedEntry } from '../capsule.js';
import { confirmOpenEarly, sealDialog, sealedNoticeDialog } from '../capsule-ui.js';
import { Drawing } from '../drawing.js';
import { formatLongDate, displayTitle, localISODate } from '../model.js';

export const capsuleActionMethods = {
  // ---------- time capsules ----------

  /** Asks for the day, then seals the open entry until it. */
  sealEntry() {
    if (!this.entry) return;
    sealDialog({
      entryName: displayTitle(this.snapshot()),
      onSave: (openOn) => this.sealOpenEntry(openOn),
    });
  },

  /**
   * Seals the open entry. The text is saved first, so the sealed copy is the
   * one on screen. Then the editor closes, since a sealed letter cannot be read.
   */
  async sealOpenEntry(openOn) {
    if (!this.entry) return;
    this.entry = sealedEntry(this.entry, openOn);
    await this.persist('seal');
    this.entry = null;
    await this.showHome({ history: 'replace' });
    // The editor is hidden, not emptied, so clear what it holds. A sealed letter's text should not stay in the page.
    this.dom.editor.value = '';
    this.dom.title.value = '';
    this.dom.tags.value = '';
    this.dom.editor.setMedia(null);
    this.drawing = new Drawing();
    this.rebuildInk();
    this.showStatus(`Sealed. It opens ${formatLongDate(openOn)}.`, false, 'saved');
  },

  /** Shown when a sealed letter is opened from a list or a link. It offers to change the day or open it early. */
  showSealedNotice(entry) {
    sealedNoticeDialog({
      entry,
      onChangeDate: () =>
        sealDialog({
          title: 'Change the open day',
          submitLabel: 'Save day',
          current: entry.capsule.openOn,
          onSave: (openOn) => this.changeSealDate(entry.id, openOn),
        }),
      onOpenEarly: () => this.openSealedEarly(entry.id),
    });
  },

  async changeSealDate(id, openOn) {
    const current = await this.store.get(id);
    if (!current || capsuleStatus(current) !== 'sealed') return;
    await this.store.save(rescheduledEntry(current, openOn));
    await this.refreshHome();
    this.showStatus(`Now opens ${formatLongDate(openOn)}.`, false, 'saved');
  },

  /** Ends a seal before its day, after a confirm. The unsealing does not play. */
  async openSealedEarly(id) {
    const current = await this.store.get(id);
    if (!current || capsuleStatus(current) !== 'sealed') return;
    if (!(await confirmOpenEarly(current))) return;
    await this.store.save(unsealedEntry(current));
    await this.openEntry(id);
  },

  /**
   * Sends one notice for each capsule that has arrived and not been notified
   * yet. `send(body, tag)` shows the notice. The notice names no title, since
   * it can appear on a lock screen. A capsule can only arrive on a new day, so
   * the library is read once per day, and again if a send fails.
   */
  async announceArrivedCapsules(send) {
    const today = localISODate();
    if (this.capsuleScanDay === today) return;
    for (const entry of await this.store.list()) {
      if (capsuleStatus(entry, today) !== 'ready' || entry.capsule.notified) continue;
      await send('A time capsule is ready to open in Quire.', `quire-capsule-${entry.id}`);
      await this.store.save({ ...entry, capsule: { ...entry.capsule, notified: true } });
    }
    this.capsuleScanDay = today;
  },
};
