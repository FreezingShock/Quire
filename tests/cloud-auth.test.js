import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeFor, randomVerifier } from '../src/cloud/pkce.js';
import { createAuth } from '../src/cloud/auth.js';
import { CloudError } from '../src/cloud/http.js';
import { createMemoryStore } from '../src/storage.js';
import { createVault } from '../src/vault.js';

const URL_BASE = 'https://proj.supabase.co';
const KEY = 'anon-key-value';

/** A fetch that records each call and answers with the next canned response. */
function fakeFetch(...responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    return new Response(next.body === undefined ? '' : JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return { calls, fetchImpl };
}

test('PKCE challenge matches the RFC 7636 example', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(await challengeFor(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('a random verifier is 43 to 128 unreserved characters and differs each time', () => {
  const a = randomVerifier();
  const b = randomVerifier();
  assert.match(a, /^[A-Za-z0-9_-]{43,128}$/);
  assert.notEqual(a, b);
});

test('the Google address carries the PKCE challenge and the redirect', () => {
  const auth = createAuth({ url: URL_BASE, anonKey: KEY, fetchImpl: fakeFetch().fetchImpl });
  const address = new URL(auth.googleUrl({ redirectTo: 'https://quire.example/app', codeChallenge: 'chal' }));
  assert.equal(address.origin + address.pathname, `${URL_BASE}/auth/v1/authorize`);
  assert.equal(address.searchParams.get('provider'), 'google');
  assert.equal(address.searchParams.get('redirect_to'), 'https://quire.example/app');
  assert.equal(address.searchParams.get('code_challenge'), 'chal');
  assert.equal(address.searchParams.get('code_challenge_method'), 's256');
});

test('exchanging the code sends the verifier and returns a session', async () => {
  const { calls, fetchImpl } = fakeFetch({ body: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, user: { id: 'u1', email: 'n@example.com' } } });
  const auth = createAuth({ url: URL_BASE, anonKey: KEY, fetchImpl, clock: () => 1000 });
  const session = await auth.exchangeCode({ code: 'the-code', verifier: 'the-verifier' });

  assert.equal(calls[0].url, `${URL_BASE}/auth/v1/token?grant_type=pkce`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { auth_code: 'the-code', code_verifier: 'the-verifier' });
  assert.equal(calls[0].init.headers.apikey, KEY);
  assert.equal(session.accessToken, 'at');
  assert.equal(session.refreshToken, 'rt');
  assert.equal(session.expiresAt, 1000 + 3600 * 1000);
  assert.equal(session.user.email, 'n@example.com');
});

test('a magic link request asks for a PKCE code and creates the user if needed', async () => {
  const { calls, fetchImpl } = fakeFetch({ body: {} });
  const auth = createAuth({ url: URL_BASE, anonKey: KEY, fetchImpl });
  await auth.sendMagicLink({ email: 'n@example.com', redirectTo: 'https://quire.example/app', codeChallenge: 'chal' });

  assert.match(calls[0].url, /\/auth\/v1\/otp\?redirect_to=/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'n@example.com', create_user: true, code_challenge: 'chal', code_challenge_method: 's256' });
});

test('password sign-in reports a plain message when the details do not match', async () => {
  const { fetchImpl } = fakeFetch({ status: 400, body: { error: 'invalid_grant', error_description: 'Invalid login credentials' } });
  const auth = createAuth({ url: URL_BASE, anonKey: KEY, fetchImpl });
  await assert.rejects(auth.signInWithPassword({ email: 'n@example.com', password: 'nope' }), (error) => error instanceof CloudError && error.message === 'Invalid login credentials');
});

test('signup without a session tells the caller to confirm the email first', async () => {
  const { fetchImpl } = fakeFetch({ body: { id: 'u2', email: 'n@example.com' } });
  const auth = createAuth({ url: URL_BASE, anonKey: KEY, fetchImpl });
  const result = await auth.signUp({ email: 'n@example.com', password: 'long-enough' });
  assert.equal(result.session, null);
  assert.equal(result.needsConfirmation, true);
});

test('a refresh that returns no token is reported as an expired sign-in', async () => {
  const { fetchImpl } = fakeFetch({ status: 400, body: {} });
  const auth = createAuth({ url: URL_BASE, anonKey: KEY, fetchImpl });
  await assert.rejects(auth.refresh('old'), (error) => error.status === 401);
});

test('a network failure becomes a readable message', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  const auth = createAuth({ url: URL_BASE, anonKey: KEY, fetchImpl });
  await assert.rejects(auth.signInWithPassword({ email: 'a', password: 'b' }), (error) => error instanceof CloudError && /could not reach/.test(error.message));
});

test('the account record is sealed under the lock and reads back under the same key', async () => {
  const store = createMemoryStore();
  const vault = createVault(await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']));
  store.setCipher(vault);
  await store.setAccount({ session: { accessToken: 'secret-token', refreshToken: 'secret-refresh', expiresAt: 5, user: { id: 'u', email: 'n@example.com' } }, sync: null });

  const raw = JSON.stringify(await store.getMeta('account'));
  assert.equal(raw.includes('secret-token'), false);
  assert.equal((await store.getAccount()).session.accessToken, 'secret-token');
  assert.equal(store.cipher(), vault);
});

test('a locked store does not expose the account record or the cipher', () => {
  const store = createMemoryStore();
  assert.equal(store.cipher(), null);
});

test('signing out clears the account record', async () => {
  const store = createMemoryStore();
  store.setCipher(null);
  await store.setAccount({ session: { accessToken: 'x' } });
  await store.setAccount(null);
  assert.equal(await store.getAccount(), null);
});
