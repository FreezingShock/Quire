/**
 * The account controller: sign-in, sign-out, the sync pass, and the new-device
 * step that adopts the account's passcode. No DOM here. The dialogs in
 * src/account-dialogs.js call these and show what they return.
 *
 * The session and sync state live in the store's sealed account record, so the
 * passcode lock covers them like every other row. The one exception is the PKCE
 * verifier for a sign-in in progress, which lives in sessionStorage for the
 * length of the redirect. It is single-use and holds no secret worth keeping.
 */

import { LOCK_META } from '../lock.js';
import { unlockLock } from '../vault.js';
import { CLOUD, cloudConfigured } from './config.js';
import { createAuth } from './auth.js';
import { CloudError } from './http.js';
import { challengeFor, randomVerifier } from './pkce.js';
import { decodeLock, encodeLock } from './codec.js';
import { desktopInvoke, isDesktop } from '../desktop.js';
import { createRemote } from './remote.js';
import { KeyMismatchError, syncOnce } from './sync-engine.js';

const VERIFIER_KEY = 'quire-pkce-verifier';
const REFRESH_MARGIN_MS = 60 * 1000;
/** The desktop app's sign-in port. Supabase's redirect allow list must name it. See src-tauri/src/oauth.rs. */
const DESKTOP_REDIRECT = 'http://127.0.0.1:53847/callback';

/** This device has no lock yet, and the account already has one. The caller asks for that passcode. */
export class NeedsAccountPasscode extends Error {
  constructor(remoteKey) {
    super('Your account already has a passcode lock. Type that passcode to use it on this device.');
    this.name = 'NeedsAccountPasscode';
    this.remoteKey = remoteKey;
  }
}

/** The account has no lock yet and this device has none either. The passcode lock has to be set up first. */
export class NeedsPasscodeSetup extends Error {
  constructor() {
    super('Turn on the passcode lock first. Sync encrypts your entries with it before they leave this browser.');
    this.name = 'NeedsPasscodeSetup';
  }
}

export { cloudConfigured };

function client() {
  return createAuth({ url: CLOUD.supabaseUrl, anonKey: CLOUD.supabaseAnonKey });
}

export function redirectTarget() {
  if (isDesktop()) return DESKTOP_REDIRECT;
  return CLOUD.redirectTo || `${location.origin}${location.pathname}`;
}

/** In the desktop app, the sign-in redirect comes back to a listener on this computer. Start it before the browser is sent away. */
async function prepareRedirect() {
  if (isDesktop()) await desktopInvoke('plugin:oauth|listen');
}

/** Opens a sign-in page: in the system browser on desktop, in this tab on the web. */
export async function openSignInPage(url) {
  if (isDesktop()) {
    await desktopInvoke('plugin:oauth|open_in_browser', { url });
    return;
  }
  location.assign(url);
}

async function saveSession(store, session) {
  const account = (await store.getAccount()) ?? {};
  await store.setAccount({ ...account, session, sync: account.sync ?? null });
  return session;
}

/** The access token, renewed first when it is near expiry. */
async function freshToken(store) {
  const account = await store.getAccount();
  const session = account?.session;
  if (!session) throw new CloudError('Sign in to sync.', { status: 401 });
  if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return session.accessToken;
  const renewed = await client().refresh(session.refreshToken);
  await saveSession(store, renewed);
  return renewed.accessToken;
}

export async function accountState(store) {
  const account = await store.getAccount();
  return {
    signedIn: Boolean(account?.session),
    email: account?.session?.user?.email ?? '',
    syncedAt: account?.sync?.syncedAt ?? null,
  };
}

export async function signInWithPassword(store, { email, password }) {
  await saveSession(store, await client().signInWithPassword({ email, password }));
}

/** Creates the account. Resolves { needsConfirmation } when the project asks for an email check first. */
export async function createAccountWithPassword(store, { email, password }) {
  const { session, needsConfirmation } = await client().signUp({ email, password, redirectTo: redirectTarget() });
  if (session) await saveSession(store, session);
  return { needsConfirmation };
}

/** Emails a sign-in link. The link has to be opened in this same browser, because the verifier stays here. */
export async function sendMagicLink({ email }) {
  await prepareRedirect();
  const verifier = randomVerifier();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  await client().sendMagicLink({ email, redirectTo: redirectTarget(), codeChallenge: await challengeFor(verifier) });
}

/** Starts Google sign-in. Returns the address to open; the caller moves the page there. */
export async function googleSignInUrl() {
  await prepareRedirect();
  const verifier = randomVerifier();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  return client().googleUrl({ redirectTo: redirectTarget(), codeChallenge: await challengeFor(verifier) });
}

/**
 * Finishes a sign-in when this page was opened from a redirect. Returns null
 * when the address has nothing for sign-in, otherwise { signedIn } or { error }.
 * The code is removed from the address bar whatever happens.
 */
export async function finishSignInFromUrl(store) {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return null;
  history.replaceState(null, '', location.pathname + location.hash);
  if (params.has('error')) return { error: params.get('error_description') || 'Sign-in was cancelled.' };
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  if (!verifier) return { error: 'That sign-in link is out of date. Start sign-in again.' };
  await saveSession(store, await client().exchangeCode({ code: params.get('code'), verifier }));
  return { signedIn: true };
}

/** Ends the session on the server and forgets the account here. Entries stay on this device. */
export async function signOut(store) {
  const account = await store.getAccount();
  if (account?.session) await client().signOut(account.session.accessToken);
  await store.setAccount(null);
}

/**
 * Runs a sync pass, and one more if the server refused some rows, since a
 * refused row is newer on the server and the second pass pulls it. Throws
 * NeedsAccountPasscode or NeedsPasscodeSetup when this device lacks the key.
 */
export async function syncNow(store) {
  const remote = createRemote({ url: CLOUD.supabaseUrl, anonKey: CLOUD.supabaseAnonKey, getToken: () => freshToken(store) });
  const vault = store.cipher();
  if (!vault) {
    const remoteKey = await remote.getKey();
    if (remoteKey) throw new NeedsAccountPasscode(remoteKey);
    throw new NeedsPasscodeSetup();
  }
  let summary = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const account = await store.getAccount();
    if (!account?.session) throw new CloudError('Sign in to sync.', { status: 401 });
    const lockRecord = await store.getMeta(LOCK_META);
    let result;
    try {
      result = await syncOnce({ local: store, remote, vault, lock: encodeLock(lockRecord), state: account.sync ?? {} });
    } catch (error) {
      if (error instanceof KeyMismatchError) throw new NeedsAccountPasscode(error.remoteKey);
      throw error;
    }
    if (result.summary.lockAdopted) await store.setMeta(LOCK_META, decodeLock(result.summary.lockAdopted));
    const latest = await store.getAccount();
    await store.setAccount({ ...latest, sync: result.state });
    summary = result.summary;
    if (!summary.refused) break;
  }
  return summary;
}

/**
 * New device, or a device with a different lock: uses the account's passcode.
 * Local entries are re-encrypted with the account's key, so every device holds
 * the same key. Returns false when the passcode is wrong.
 */
export async function adoptAccountPasscode(store, remoteKey, passcode) {
  const remoteLock = decodeLock(remoteKey.lock);
  const vault = await unlockLock(remoteLock, passcode);
  if (!vault) return false;
  await store.reseal(vault);
  await store.setMeta(LOCK_META, remoteLock);
  return true;
}
