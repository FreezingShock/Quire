import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/storage.js';
import { createVault } from '../src/vault.js';
import { normalizeEntry } from '../src/model.js';

const CLIP = 'data:audio/webm;base64,AAAA';
const OTHER = 'data:audio/webm;base64,BBBB';
const newVault = async () => createVault(await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']));

/** An old version, written the way the previous build wrote it: with its own copy of the clip. */
function legacyVersion(entryId, id, content) {
  return { id, entryId, savedAt: '2026-11-10T10:00:00.000Z', reason: 'auto', content };
}

const content = (body, audio) => ({ title: 'Walk', date: '2026-11-10', kind: 'journal', tags: [], body, pageColor: '#fffdf8', ink: { ops: [] }, audio });

test('the move drops the copy from a version and keeps the clip the entry holds', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  await store.save(normalizeEntry({ id: 'e1', body: '![Voice note](quire-audio:a1)', audio: { a1: CLIP } }));
  await store.saveVersion(legacyVersion('e1', 'v1', content('![Voice note](quire-audio:a1)', { a1: CLIP })), 30);

  assert.equal(await store.migrateVersionClips(), 0, 'nothing had to be written, the entry already held it');
  const [version] = await store.listVersions('e1');
  assert.equal('audio' in version.content, false);
  assert.equal((await store.get('e1')).audio.a1, CLIP);
});

test('a clip the entry does not hold is written to the entry before its copy is dropped', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  await store.save(normalizeEntry({ id: 'e2', body: 'Words' }));
  await store.saveVersion(legacyVersion('e2', 'v2', content('![Voice note](quire-audio:a2)', { a2: OTHER })), 30);

  assert.equal(await store.migrateVersionClips(), 1);
  assert.equal((await store.get('e2')).audio.a2, OTHER);
  assert.equal('audio' in (await store.listVersions('e2'))[0].content, false);
});

test('running the move again changes nothing', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  await store.save(normalizeEntry({ id: 'e3', body: 'Words' }));
  await store.saveVersion(legacyVersion('e3', 'v3', content('![Voice note](quire-audio:a3)', { a3: CLIP })), 30);
  await store.migrateVersionClips();
  assert.equal(await store.migrateVersionClips(), 0);
  assert.equal((await store.get('e3')).audio.a3, CLIP);
});

test('a sealed version is moved too, and stays sealed', async () => {
  const store = createMemoryStore();
  const vault = await newVault();
  store.setCipher(vault);
  await store.save(normalizeEntry({ id: 'e4', body: 'Words' }));
  await store.saveVersion(legacyVersion('e4', 'v4', content('![Voice note](quire-audio:a4)', { a4: CLIP })), 30);
  assert.equal(await store.migrateVersionClips(), 1);
  const [version] = await store.listVersions('e4');
  assert.equal('audio' in version.content, false);
  assert.equal((await store.get('e4')).audio.a4, CLIP);
});
