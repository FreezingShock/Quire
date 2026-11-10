/**
 * The mixtape strip above the page: a cassette, the song list, and the service's
 * own player. The cassette is drawn in CSS, so it works offline. Playback runs in
 * the service's embed, which Quire does not control, so the reels turn while a
 * player is open and Stop removes the player. The song rules live in mixtape.js.
 * Also holds the dialog that adds a song from a pasted link.
 */

import { el } from './dom.js';
import { showDialog } from './dialogs.js';
import {
  MAX_TRACKS,
  addProblem,
  embedHeight,
  embedUrl,
  fetchSongInfo,
  parseSongLink,
  SERVICES,
  trackTitle,
} from './mixtape.js';

const PLAYER_PERMISSIONS = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
const LOOKUP_DELAY_MS = 350;

export class MixtapeView {
  /** `root` is the section that holds the strip. `handlers` are { onAdd, onRemove(id), onMove(id, direction) }. */
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.entryId = null;
    this.tracks = [];
    this.currentId = null; // the song the cassette shows
    this.playing = false;
    // The deck is rebuilt on every change. The stage holds the player and is only rebuilt when its
    // source changes, because moving the iframe in the page reloads it and would restart the song.
    this.deck = el('div', { class: 'mixtape-deck' });
    this.stage = el('div', { class: 'mixtape-stage', hidden: true });
    this.stageKey = null;
    this.root.replaceChildren(this.deck, this.stage);
    this.render();
  }

  /** Shows an entry's songs. Changing to another entry stops playback. */
  setEntry(entryId, tracks = []) {
    if (entryId !== this.entryId) {
      this.playing = false;
      this.currentId = null;
    }
    this.entryId = entryId;
    this.tracks = tracks;
    if (!tracks.some((track) => track.id === this.currentId)) {
      this.currentId = null;
      this.playing = false;
    }
    this.render();
  }

  /** Stops the player. Called when the editor closes, so a song does not keep playing on the entries list. */
  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.render();
  }

  current() {
    return this.tracks.find((track) => track.id === this.currentId) ?? null;
  }

  playSong(track) {
    this.currentId = track.id;
    this.playing = true;
    this.render();
  }

  play() {
    const track = this.current() ?? this.tracks[0];
    if (track) this.playSong(track);
  }

  stopPlaying() {
    this.playing = false;
    this.render();
  }

  skip(direction) {
    const index = this.tracks.findIndex((track) => track.id === this.currentId);
    const next = this.tracks[index + direction];
    if (next) {
      this.currentId = next.id;
      this.render();
    }
  }

  render() {
    const current = this.current();
    const index = this.tracks.findIndex((track) => track.id === this.currentId);
    const full = this.tracks.length >= MAX_TRACKS;
    // With nothing picked yet, the cassette labels itself with the first song.
    this.deck.replaceChildren(this.cassette(current ?? this.tracks[0] ?? null), this.controls(current, index, full));
    this.syncStage(current);
  }

  cassette(current) {
    const count = this.tracks.length;
    return el(
      'div',
      { class: `cassette${this.playing ? ' is-playing' : ''}`, 'aria-hidden': 'true' },
      el(
        'div',
        { class: 'cassette-label' },
        el('span', { class: 'cassette-side' }, count ? `Side A · ${count} ${count === 1 ? 'song' : 'songs'}` : 'Blank side'),
        el('span', { class: 'cassette-title' }, current ? trackTitle(current) : 'Make a mixtape'),
        el('span', { class: 'cassette-artist' }, current?.artist ?? ''),
      ),
      el('div', { class: 'cassette-window' }, el('span', { class: 'cassette-reel' }), el('span', { class: 'cassette-reel' })),
    );
  }

  controls(current, index, full) {
    const last = this.tracks.length - 1;
    const playButton = this.playing
      ? el('button', { class: 'btn', type: 'button', onClick: () => this.stopPlaying() }, 'Stop')
      : el('button', { class: 'btn btn-primary', type: 'button', disabled: !this.tracks.length, onClick: () => this.play() }, 'Play');
    return el(
      'div',
      { class: 'mixtape-main' },
      el(
        'div',
        { class: 'mixtape-controls', role: 'group', 'aria-label': 'Mixtape controls' },
        playButton,
        el('button', { class: 'btn', type: 'button', disabled: index <= 0, onClick: () => this.skip(-1) }, 'Prev'),
        el('button', { class: 'btn', type: 'button', disabled: index < 0 || index >= last, onClick: () => this.skip(1) }, 'Next'),
        el(
          'button',
          {
            class: 'btn',
            type: 'button',
            disabled: full,
            title: full ? `A mixtape holds ${MAX_TRACKS} songs` : 'Paste a Spotify or YouTube link',
            onClick: () => this.handlers.onAdd(),
          },
          'Add song…',
        ),
      ),
      this.tracks.length
        ? el(
            'ol',
            { class: 'mixtape-list', 'aria-label': 'Songs on this mixtape' },
            this.tracks.map((track, i) => this.row(track, i, last)),
          )
        : el('p', { class: 'mixtape-empty' }, 'Paste a Spotify or YouTube link to put the first song on this side.'),
    );
  }

  row(track, i, last) {
    const name = trackTitle(track);
    const current = track.id === this.currentId;
    return el(
      'li',
      { class: `mixtape-row${current ? ' is-current' : ''}` },
      el(
        'button',
        {
          class: 'mixtape-play',
          type: 'button',
          'aria-current': current && this.playing ? 'true' : null,
          onClick: () => this.playSong(track),
        },
        el('span', { class: 'mixtape-num' }, String(i + 1)),
        el('span', { class: 'mixtape-name' }, name),
        track.artist ? el('span', { class: 'mixtape-artist' }, track.artist) : null,
        el('span', { class: 'mixtape-service' }, SERVICES[track.service]?.label ?? ''),
      ),
      el(
        'span',
        { class: 'mixtape-tools' },
        el('button', { class: 'mixtape-tool', type: 'button', disabled: i === 0, 'aria-label': `Move ${name} up`, title: 'Move up', onClick: () => this.handlers.onMove(track.id, -1) }, '▲'),
        el('button', { class: 'mixtape-tool', type: 'button', disabled: i === last, 'aria-label': `Move ${name} down`, title: 'Move down', onClick: () => this.handlers.onMove(track.id, 1) }, '▼'),
        el('button', { class: 'mixtape-tool', type: 'button', 'aria-label': `Remove ${name}`, title: 'Remove', onClick: () => this.handlers.onRemove(track.id) }, '×'),
      ),
    );
  }

  /** Shows the service's player for the playing song. The player is replaced only when its source changes. */
  syncStage(current) {
    const offline = navigator.onLine === false;
    let key = null;
    if (this.playing && current) key = offline ? 'offline' : embedUrl(current);
    if (key === this.stageKey) return;
    this.stageKey = key;
    this.stage.replaceChildren();
    this.stage.hidden = !key;
    if (key === 'offline') {
      this.stage.append(
        el('p', { class: 'mixtape-note', role: 'status' }, 'You are offline, so the player cannot load. The title and artist are saved with the entry.'),
      );
    } else if (key) {
      this.stage.append(
        el('iframe', {
          class: 'mixtape-frame',
          src: key,
          height: embedHeight(current),
          title: `${trackTitle(current)} on ${SERVICES[current.service]?.label ?? 'the web'}`,
          allow: PLAYER_PERMISSIONS,
          loading: 'lazy',
          referrerpolicy: 'strict-origin-when-cross-origin',
        }),
      );
    }
  }
}

/**
 * The add-a-song dialog. Pasting a link checks it at once and looks up the
 * title after a short pause. A lookup that fails leaves the fields to type in.
 * `onSave({ url, title, artist })` runs when the user adds the song.
 */
export function songDialog({ existing = [], onSave }) {
  let found = null; // the parsed link when the box holds a playable one
  let lookupTimer = 0;
  let lookupId = 0;

  const link = el('input', {
    class: 'dialog-input',
    type: 'url',
    inputmode: 'url',
    placeholder: 'https://open.spotify.com/track/… or https://youtu.be/…',
    'aria-label': 'Song link',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const title = el('input', { class: 'dialog-input', type: 'text', maxlength: '120', placeholder: 'Shown on the cassette', 'aria-label': 'Song title', autocomplete: 'off' });
  const artist = el('input', { class: 'dialog-input', type: 'text', maxlength: '120', placeholder: 'Optional', 'aria-label': 'Artist', autocomplete: 'off' });
  const status = el('p', { class: 'dialog-text mixtape-status', role: 'status', 'aria-live': 'polite' }, 'Paste a link from Spotify or YouTube.');
  const save = el('button', { class: 'btn btn-primary', type: 'submit', disabled: true }, 'Add to mixtape');
  const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');

  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle('is-error', isError);
  };

  const lookup = async (parsed) => {
    const id = ++lookupId;
    setStatus('Looking up the title…');
    try {
      const info = await fetchSongInfo(parsed);
      if (id !== lookupId) return;
      if (!title.value.trim()) title.value = info.title;
      if (!artist.value.trim()) artist.value = info.artist;
      setStatus(info.title ? `Found “${info.title}”. Change the title or artist if you like.` : 'Found the song. Type a title if you like.');
    } catch {
      if (id !== lookupId) return;
      setStatus('Could not look up the title, maybe because you are offline. Type it in below. It is saved with the song.', true);
    }
  };

  const check = () => {
    clearTimeout(lookupTimer);
    const text = link.value.trim();
    found = null;
    save.disabled = true;
    if (!text) {
      setStatus('Paste a link from Spotify or YouTube.');
      return;
    }
    const parsed = parseSongLink(text);
    const problem = addProblem(existing, parsed);
    if (problem) {
      setStatus(problem, true);
      return;
    }
    found = parsed;
    save.disabled = false;
    // Looks up the title only when the title box is empty, so a title typed by hand is kept.
    if (!title.value.trim()) {
      lookupTimer = setTimeout(() => lookup(parsed), LOOKUP_DELAY_MS);
    } else {
      setStatus('Ready to add.');
    }
  };
  link.addEventListener('input', check);

  const dialog = el(
    'dialog',
    { class: 'dialog mixtape-dialog' },
    el(
      'form',
      {
        class: 'dialog-form',
        onSubmit: (event) => {
          event.preventDefault();
          if (!found) return;
          clearTimeout(lookupTimer);
          onSave({ url: found.url, title: title.value, artist: artist.value });
          dialog.close();
        },
      },
      el('h2', { class: 'dialog-title' }, 'Add a song to the mixtape'),
      el('label', { class: 'mixtape-field' }, el('span', {}, 'Song link'), link),
      el('label', { class: 'mixtape-field' }, el('span', {}, 'Title'), title),
      el('label', { class: 'mixtape-field' }, el('span', {}, 'Artist'), artist),
      status,
      el('div', { class: 'dialog-actions' }, cancel, save),
    ),
  );
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => clearTimeout(lookupTimer), { once: true });
  showDialog(dialog);
  link.focus();
}
