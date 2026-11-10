/**
 * Mixtape: song links attached to an entry. A track keeps the canonical link,
 * the service and the media id, plus a title and artist typed in or fetched
 * once. The player is the service's own embed, so Quire never holds a login or
 * audio. Pure helpers only (no DOM, no storage), so node:test can cover them.
 *
 * Supported links: Spotify tracks, albums, playlists and episodes, and YouTube
 * videos (watch, youtu.be, shorts, and music.youtube.com).
 */

/** Most songs one entry's mixtape can hold. */
export const MAX_TRACKS = 12;
/** How long the title lookup may run before the dialog asks for the title by hand. */
export const LOOKUP_TIMEOUT_MS = 8000;

const SPOTIFY_KINDS = new Set(['track', 'album', 'playlist', 'episode']);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_URI = /^spotify:(track|album|playlist|episode):([A-Za-z0-9]{22})$/;
const SPOTIFY_PATH = /^\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode)\/([A-Za-z0-9]{22})\/?$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const EMBED_HEIGHTS = { track: 152, episode: 232, album: 352, playlist: 352, video: 226 };

/** Services, by the name shown in the UI. */
export const SERVICES = Object.freeze({
  spotify: { label: 'Spotify' },
  youtube: { label: 'YouTube' },
});

const KIND_LABELS = { track: 'Song', album: 'Album', playlist: 'Playlist', episode: 'Episode', video: 'Video' };

function newTrackId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Trims text and caps its length. Anything that is not text becomes an empty string. */
function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function spotifyLink(kind, mediaId) {
  return { service: 'spotify', kind, mediaId, url: `https://open.spotify.com/${kind}/${mediaId}` };
}

function youtubeLink(mediaId) {
  return { service: 'youtube', kind: 'video', mediaId, url: `https://www.youtube.com/watch?v=${mediaId}` };
}

/**
 * A song link as { service, kind, mediaId, url } with the canonical url, or null
 * when the text is not a link Quire can play. Accepts a bare host ("youtu.be/…")
 * and the spotify: URI form.
 */
export function parseSongLink(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const uri = SPOTIFY_URI.exec(text);
  if (uri) return spotifyLink(uri[1], uri[2]);

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase();
  if (host === 'open.spotify.com') {
    const match = SPOTIFY_PATH.exec(url.pathname);
    return match ? spotifyLink(match[1], match[2]) : null;
  }
  if (host === 'youtu.be') {
    const id = url.pathname.split('/')[1] ?? '';
    return YOUTUBE_ID.test(id) ? youtubeLink(id) : null;
  }
  if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      const id = url.searchParams.get('v') ?? '';
      return YOUTUBE_ID.test(id) ? youtubeLink(id) : null;
    }
    const match = /^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname);
    return match ? youtubeLink(match[1]) : null;
  }
  return null;
}

/** The address of a service's own player for a track. */
export function embedUrl(track) {
  if (track.service === 'spotify') return `https://open.spotify.com/embed/${track.kind}/${track.mediaId}`;
  return `https://www.youtube.com/embed/${track.mediaId}`;
}

/** Height of the player in pixels, sized for the kind of link. */
export function embedHeight(track) {
  return EMBED_HEIGHTS[track.kind] ?? 152;
}

/** The oEmbed address that returns a track's title (and a YouTube channel name). */
export function oembedUrl(track) {
  const target = encodeURIComponent(track.url);
  if (track.service === 'spotify') return `https://open.spotify.com/oembed?url=${target}`;
  return `https://www.youtube.com/oembed?format=json&url=${target}`;
}

export function kindLabel(track) {
  return KIND_LABELS[track.kind] ?? 'Song';
}

/** What a track is called on the cassette and in the list. */
export function trackTitle(track) {
  return track.title || `${kindLabel(track)} on ${SERVICES[track.service]?.label ?? 'the web'}`;
}

/** Turns a stored or pasted track into the shape the entry keeps. Null when the link is not playable. */
export function normalizeTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const link = parseSongLink(raw.url);
  if (!link) return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : newTrackId();
  return {
    id,
    ...link,
    title: cleanText(raw.title, 120),
    artist: cleanText(raw.artist, 120),
  };
}

/** The tracks an entry holds: playable ones only, in order, at most MAX_TRACKS. */
export function normalizeMixtape(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeTrack).filter(Boolean).slice(0, MAX_TRACKS);
}

/** Why a link cannot be added to the list, or an empty string when it can. */
export function addProblem(tracks, link) {
  if (!link) return 'That does not look like a Spotify or YouTube song link.';
  if (tracks.some((track) => track.service === link.service && track.mediaId === link.mediaId)) {
    return 'That song is already on this mixtape.';
  }
  if (tracks.length >= MAX_TRACKS) return `A mixtape holds ${MAX_TRACKS} songs. Remove one to add another.`;
  return '';
}

/** A list with the track moved one place up (-1) or down (1). The same list comes back when it cannot move. */
export function moveTrack(tracks, id, direction) {
  const index = tracks.findIndex((track) => track.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= tracks.length) return tracks;
  const next = [...tracks];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function removeTrack(tracks, id) {
  return tracks.filter((track) => track.id !== id);
}

/**
 * Title and artist from a service's oEmbed reply. Spotify does not name the
 * artist there, so the artist comes back empty for it.
 */
export function readOembed(track, data) {
  return {
    title: cleanText(data?.title, 120),
    artist: track.service === 'youtube' ? cleanText(data?.author_name, 120) : '',
  };
}

/**
 * Looks up a track's title. Resolves with { title, artist }, and rejects when the
 * network is down, the service refuses, or the lookup runs past LOOKUP_TIMEOUT_MS.
 * The caller decides what to show, so a failed lookup never blocks saving a song.
 */
export async function fetchSongInfo(track, fetchFn = globalThis.fetch) {
  const signal = AbortSignal.timeout?.(LOOKUP_TIMEOUT_MS);
  const response = await fetchFn(oembedUrl(track), { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`The lookup failed (${response.status}).`);
  return readOembed(track, await response.json());
}
