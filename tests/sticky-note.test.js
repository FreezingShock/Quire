import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/storage.js';
import { createVault } from '../src/vault.js';

const newVault = async () => createVault(await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']));

test('the sticky note reads back empty until something is saved', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  assert.equal(await store.getNote(), '');
});

test('the sticky note is stored sealed while the lock is on, and reads back through the vault', async () => {
  const store = createMemoryStore();
  const vault = await newVault();
  store.setCipher(vault);
  await store.setNote('private words');
  assert.equal(await store.getNote(), 'private words');
  // A reader without the vault cannot open the note.
  store.setCipher(null);
  await assert.rejects(store.getNote());
});

test('turning the lock on and off keeps the sticky note', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  await store.setNote('keep me');
  const vault = await newVault();
  await store.reseal(vault);
  store.setCipher(vault);
  assert.equal(await store.getNote(), 'keep me');
  await store.reseal(null);
  store.setCipher(null);
  assert.equal(await store.getNote(), 'keep me');
});
