/**
 * The account's rows on the server: the passcode lock record (sync_keys) and
 * the sealed entries (entries). Row-level security limits every call to the
 * signed-in user, so this file never filters by user id itself.
 */

import { createHttp } from './http.js';

/** Revisions re-read on each pull. A sequence value can commit after a later one, so a small overlap keeps rows from being skipped. Re-reading a row is harmless. */
export const PULL_OVERLAP = 100;
export const PULL_PAGE = 500;

export function createRemote({ url, anonKey, getToken, fetchImpl = globalThis.fetch }) {
  const request = createHttp({ url, anonKey, fetchImpl });
  const call = async (path, options = {}) => request(path, { ...options, token: await getToken() });
  return {
    /** The account's lock record and key check, or null when no device has set one up yet. */
    async getKey() {
      const rows = await call('/rest/v1/sync_keys?select=lock,check');
      return rows?.[0] ?? null;
    },
    async putKey({ lock, check }) {
      await call('/rest/v1/sync_keys?on_conflict=user_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: { lock, check },
      });
    },
    /** Every entry row with a revision after `afterRevision`, oldest first. */
    async pullEntries(afterRevision) {
      const rows = [];
      let from = Math.max(0, afterRevision - PULL_OVERLAP);
      for (;;) {
        const page = await call(
          `/rest/v1/entries?select=entry_id,revision,client_updated_at,deleted,payload&revision=gt.${from}&order=revision.asc&limit=${PULL_PAGE}`,
        );
        rows.push(...page);
        if (page.length < PULL_PAGE) return rows;
        from = page[page.length - 1].revision;
      }
    },
    /** Sends rows through the server's last-writer-wins function. Returns the rows it accepted; a row is refused when the server holds a newer copy. */
    async pushEntries(rows) {
      return call('/rest/v1/rpc/push_entries', { method: 'POST', body: { rows } });
    },
  };
}
