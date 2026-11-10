/** Mixtape actions for the Quire controller: adding, reordering and removing the songs on an entry. Mixed into QuireApp. */

import { songDialog } from '../mixtape-view.js';
import { addProblem, moveTrack, normalizeTrack, parseSongLink, removeTrack } from '../mixtape.js';

export const mixtapeMethods = {
  // ---------- mixtape ----------

  /** Opens the add-a-song dialog. A saved song goes on the open entry's mixtape. */
  addSong() {
    const entry = this.entry;
    if (!entry) return;
    songDialog({
      existing: entry.mixtape,
      onSave: (fields) => {
        if (this.entry !== entry) return; // the entry was closed while the dialog was open
        const problem = addProblem(this.entry.mixtape, parseSongLink(fields.url));
        if (problem) {
          this.showStatus(problem, true);
          return;
        }
        this.setMixtape([...this.entry.mixtape, normalizeTrack(fields)]);
        this.showStatus('Song added to the mixtape');
      },
    });
  },

  removeSong(id) {
    this.setMixtape(removeTrack(this.entry.mixtape, id));
  },

  moveSong(id, direction) {
    this.setMixtape(moveTrack(this.entry.mixtape, id, direction));
  },

  /** Stores the new song list on the open entry, redraws the strip, and schedules a save. */
  setMixtape(tracks) {
    this.entry.mixtape = tracks;
    this.mixtape.setEntry(this.entry.id, tracks);
    this.updateChrome();
    this.scheduleSave();
  },
};
