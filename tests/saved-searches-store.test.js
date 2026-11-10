import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/storage.js';
import { createVault } from '../src/vault.js';

const newVault = async () => createVault(await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']));
const LIST = [{ id: 's1', name: 'Dentist', query: 'dentist visit', filter: { type: 'all', value: '' } }];

test('saved searches read back empty until something is saved', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  assert.equal(await store.getSavedSearches(), null);
});

test('saved searches are sealed while the lock is on, and need the vault to read', async () => {
  const store = createMemoryStore();
  const vault = await newVault();
  store.setCipher(vault);
  await store.setSavedSearches(LIST);
  assert.deepEqual(await store.getSavedSearches(), LIST);
  // A reader without the vault cannot open the list.
  store.setCipher(null);
  await assert.rejects(store.getSavedSearches());
});

test('turning the lock on and off keeps saved searches', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  await store.setSavedSearches(LIST);
  const vault = await newVault();
  await store.reseal(vault);
  store.setCipher(vault);
  assert.deepEqual(await store.getSavedSearches(), LIST);
  await store.reseal(null);
  store.setCipher(null);
  assert.deepEqual(await store.getSavedSearches(), LIST);
});
