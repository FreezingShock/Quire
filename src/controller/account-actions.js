/**
 * Account and sync for the Quire controller: the File menu entry, the sign-in
 * redirect, and the background sync while signed in. Mixed into QuireApp. The
 * account modules load on demand, so the first paint does not wait for them.
 */

/** How often a signed-in Quire syncs in the background. */
export const SYNC_INTERVAL_MS = 2 * 60 * 1000;

function hasSignInReturn() {
  const params = new URLSearchParams(location.search);
  return params.has('code') || params.has('error');
}

export const accountMethods = {
  /** The account context the dialogs need. */
  accountContext() {
    return {
      store: this.store,
      lockOn: this.passcodeOn,
      status: (text, isError = false) => this.showStatus(text, isError),
      openPasscode: () => this.passcodeSettings(),
      onLockChanged: (on) => {
        this.passcodeOn = on;
      },
      onSynced: () => {},
    };
  },

  async accountSettings() {
    const { openAccountDialog } = await import('../account-dialogs.js');
    await openAccountDialog(this.accountContext());
  },

  /**
   * Runs after the store is unlocked. Finishes a sign-in that came back from a
   * redirect, and starts background sync when an account is signed in.
   */
  async startAccount() {
    if (!this.store || this.store.kind !== 'indexeddb') return;
    const { cloudConfigured } = await import('../cloud/config.js');
    if (!cloudConfigured()) return;
    const account = await this.store.getAccount();
    if (!account?.session && !hasSignInReturn()) return;
    const { completeSignInRedirect, runSync } = await import('../account-dialogs.js');
    if (hasSignInReturn()) {
      await completeSignInRedirect(this.accountContext());
    } else {
      await runSync(this.accountContext());
    }
    this.startSyncTimer();
  },

  /** Syncs every few minutes and when the browser comes back online. Does nothing while signed out or locked. */
  startSyncTimer() {
    if (this.syncTimer) return;
    const tick = async () => {
      if (!this.store || !this.passcodeOn || !navigator.onLine) return;
      const { accountState } = await import('../cloud/account.js');
      if (!(await accountState(this.store)).signedIn) return;
      const { runSync } = await import('../account-dialogs.js');
      await runSync(this.accountContext());
    };
    this.syncTimer = setInterval(tick, SYNC_INTERVAL_MS);
    window.addEventListener('online', tick);
  },
};
