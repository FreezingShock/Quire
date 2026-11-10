import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TRACKS,
  addProblem,
  embedHeight,
  embedUrl,
  fetchSongInfo,
  moveTrack,
  normalizeMixtape,
  normalizeTrack,
  oembedUrl,
  parseSongLink,
  readOembed,
  removeTrack,
  trackTitle,
} from '../src/mixtape.js';
import { createEntry, normalizeEntry } from '../src/model.js';
import { contentKey } from '../src/controller/helpers.js';

const SPOTIFY_TRACK = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC';
const YOUTUBE = 'https://youtu.be/dQw4w9WgXcQ';

test('parseSongLink reads Spotify tracks, albums, playlists and episodes', () => {
  assert.deepEqual(parseSongLink(`${SPOTIFY_TRACK}?si=abc123`), {
    service: 'spotify',
    kind: 'track',
    mediaId: '4uLU6hMCjMI75M1A2tKUQC',
    url: SPOTIFY_TRACK,
  });
  assert.equal(parseSongLink('open.spotify.com/intl-de/album/0nvWXh2ZYUs7b9hVB0pc1w').kind, 'album');
  assert.equal(parseSongLink('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M').kind, 'playlist');
  assert.equal(parseSongLink('https://open.spotify.com/episode/4uLU6hMCjMI75M1A2tKUQC').kind, 'episode');
});

test('parseSongLink reads YouTube watch, short, embed and music links', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(parseSongLink(YOUTUBE).mediaId, id);
  assert.equal(parseSongLink(`https://www.youtube.com/watch?v=${id}&list=PL1`).url, `https://www.youtube.com/watch?v=${id}`);
  assert.equal(parseSongLink(`https://m.youtube.com/watch?v=${id}`).mediaId, id);
  assert.equal(parseSongLink(`https://music.youtube.com/watch?v=${id}`).mediaId, id);
  assert.equal(parseSongLink(`https://www.youtube.com/shorts/${id}`).mediaId, id);
  assert.equal(parseSongLink(`https://www.youtube.com/embed/${id}`).mediaId, id);
});

test('parseSongLink refuses anything Quire cannot play', () => {
  assert.equal(parseSongLink(''), null);
  assert.equal(parseSongLink(undefined), null);
  assert.equal(parseSongLink('javascript:alert(1)'), null);
  assert.equal(parseSongLink('https://evil.example/track/4uLU6hMCjMI75M1A2tKUQC'), null);
  assert.equal(parseSongLink('https://open.spotify.com/user/someone'), null);
  assert.equal(parseSongLink('https://open.spotify.com/track/short'), null);
  assert.equal(parseSongLink('https://www.youtube.com/watch?v=too-short'), null);
  assert.equal(parseSongLink('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'), null);
});

test('embed and lookup addresses are built from the link', () => {
  const track = parseSongLink(YOUTUBE);
  assert.equal(embedUrl(track), 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(oembedUrl(track), 'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ');
  const spotify = parseSongLink(SPOTIFY_TRACK);
  assert.equal(embedUrl(spotify), 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(embedHeight(spotify), 152);
  assert.equal(embedHeight(parseSongLink('https://open.spotify.com/album/0nvWXh2ZYUs7b9hVB0pc1w')), 352);
});

test('readOembed takes the channel name only from YouTube', () => {
  const yt = normalizeTrack({ url: YOUTUBE });
  assert.deepEqual(readOembed(yt, { title: '  Never  gonna ', author_name: 'Rick Astley' }), {
    title: 'Never gonna',
    artist: 'Rick Astley',
  });
  const sp = normalizeTrack({ url: SPOTIFY_TRACK });
  assert.deepEqual(readOembed(sp, { title: 'Song', author_name: 'ignored' }), { title: 'Song', artist: '' });
});

test('fetchSongInfo resolves the title from the service reply', async () => {
  const track = normalizeTrack({ url: YOUTUBE });
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(url);
    return { ok: true, json: async () => ({ title: 'Never gonna', author_name: 'Rick Astley' }) };
  };
  assert.deepEqual(await fetchSongInfo(track, fetchFn), { title: 'Never gonna', artist: 'Rick Astley' });
  assert.equal(seen[0], oembedUrl(track));
});

test('fetchSongInfo rejects when the service refuses or the network fails', async () => {
  const track = normalizeTrack({ url: YOUTUBE });
  await assert.rejects(fetchSongInfo(track, async () => ({ ok: false, status: 404 })), /404/);
  await assert.rejects(fetchSongInfo(track, async () => { throw new TypeError('Failed to fetch'); }));
});

test('normalizeTrack keeps the id and clears junk text', () => {
  const track = normalizeTrack({ id: 'keep-me', url: YOUTUBE, title: 'x'.repeat(300), artist: 42 });
  assert.equal(track.id, 'keep-me');
  assert.equal(track.title.length, 120);
  assert.equal(track.artist, '');
  assert.ok(normalizeTrack({ url: YOUTUBE }).id.length > 0);
  assert.equal(normalizeTrack({ url: 'nope' }), null);
  assert.equal(normalizeTrack(null), null);
});

test('normalizeMixtape drops unplayable songs and caps the list', () => {
  const many = Array.from({ length: MAX_TRACKS + 5 }, (_, i) => ({ url: `https://youtu.be/dQw4w9WgXc${String.fromCharCode(65 + i)}` }));
  const list = normalizeMixtape([{ url: 'junk' }, ...many]);
  assert.equal(list.length, MAX_TRACKS);
  assert.deepEqual(normalizeMixtape(undefined), []);
  assert.deepEqual(normalizeMixtape('not a list'), []);
});

test('addProblem blocks duplicates, unplayable links and a full list', () => {
  const list = normalizeMixtape([{ url: YOUTUBE }]);
  assert.match(addProblem(list, parseSongLink(YOUTUBE)), /already/);
  assert.match(addProblem(list, null), /does not look like/);
  assert.equal(addProblem(list, parseSongLink(SPOTIFY_TRACK)), '');
  const full = normalizeMixtape(Array.from({ length: MAX_TRACKS }, (_, i) => ({ url: `https://open.spotify.com/track/${'a'.repeat(21)}${String.fromCharCode(98 + i)}` })));
  assert.match(addProblem(full, parseSongLink(SPOTIFY_TRACK)), /holds 12/);
});

test('moveTrack and removeTrack keep the other songs in order', () => {
  const list = normalizeMixtape([
    { id: 'a', url: YOUTUBE },
    { id: 'b', url: SPOTIFY_TRACK },
    { id: 'c', url: 'https://open.spotify.com/album/0nvWXh2ZYUs7b9hVB0pc1w' },
  ]);
  assert.deepEqual(moveTrack(list, 'c', -1).map((t) => t.id), ['a', 'c', 'b']);
  assert.equal(moveTrack(list, 'a', -1), list); // already first: unchanged
  assert.equal(moveTrack(list, 'c', 1), list); // already last: unchanged
  assert.deepEqual(removeTrack(list, 'b').map((t) => t.id), ['a', 'c']);
});

test('trackTitle falls back to the kind and service', () => {
  assert.equal(trackTitle(normalizeTrack({ url: YOUTUBE })), 'Video on YouTube');
  assert.equal(trackTitle(normalizeTrack({ url: YOUTUBE, title: 'Mix' })), 'Mix');
});

test('entries keep their mixtape through the model and read back empty when there is none', () => {
  const entry = normalizeEntry({ id: 'e1', mixtape: [{ id: 't1', url: YOUTUBE, title: 'Mix' }] });
  assert.equal(entry.mixtape.length, 1);
  assert.equal(entry.mixtape[0].title, 'Mix');
  assert.deepEqual(normalizeEntry({ id: 'old' }).mixtape, []);
  assert.deepEqual(createEntry({}).mixtape, []);
});

test('a song change counts as an edit for the save key', () => {
  const entry = normalizeEntry({ id: 'e2', body: 'hi' });
  const before = contentKey(entry);
  const next = { ...entry, mixtape: normalizeMixtape([{ url: YOUTUBE }]) };
  assert.notEqual(contentKey(next), before);
});
