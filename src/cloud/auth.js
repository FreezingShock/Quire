/**
 * Supabase Auth over plain HTTP: Google sign-in with PKCE, email and password,
 * refresh and sign-out. Every call takes its fetch and clock as arguments, so
 * the tests can drive it without a network.
 */

import { createHttp, CloudError } from './http.js';

/** Turns a token response into the session the app keeps. */
export function sessionFrom(data, clock = Date.now) {
  if (!data?.access_token) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: clock() + (Number(data.expires_in) || 3600) * 1000,
    user: { id: data.user?.id ?? '', email: data.user?.email ?? '' },
  };
}

export function createAuth({ url, anonKey, fetchImpl = globalThis.fetch, clock = Date.now }) {
  const request = createHttp({ url, anonKey, fetchImpl });
  return {
    /** The address that starts Google sign-in. `codeChallenge` comes from pkce.js. */
    googleUrl({ redirectTo, codeChallenge }) {
      const params = new URLSearchParams({
        provider: 'google',
        redirect_to: redirectTo,
        code_challenge: codeChallenge,
        code_challenge_method: 's256',
      });
      return `${url}/auth/v1/authorize?${params}`;
    },
    /** Swaps the one-time code from the redirect for a session. */
    async exchangeCode({ code, verifier }) {
      const session = sessionFrom(await request('/auth/v1/token?grant_type=pkce', { method: 'POST', body: { auth_code: code, code_verifier: verifier } }), clock);
      if (!session) throw new CloudError('Google sign-in did not finish. Try again.');
      return session;
    },
    async signInWithPassword({ email, password }) {
      const session = sessionFrom(await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }), clock);
      if (!session) throw new CloudError('That email and password did not match an account.');
      return session;
    },
    /** Creates an account. `session` is null when the project asks people to confirm their email first. */
    async signUp({ email, password, redirectTo }) {
      const params = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
      const data = await request(`/auth/v1/signup${params}`, { method: 'POST', body: { email, password } });
      return { session: sessionFrom(data, clock), needsConfirmation: !data?.access_token };
    },
    /**
     * Emails a one-time sign-in link. It uses PKCE too, so the link comes back
     * with a code that the same device exchanges, like Google's redirect.
     */
    async sendMagicLink({ email, redirectTo, codeChallenge }) {
      const params = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
      await request(`/auth/v1/otp${params}`, {
        method: 'POST',
        body: { email, create_user: true, code_challenge: codeChallenge, code_challenge_method: 's256' },
      });
    },
    async refresh(refreshToken) {
      const expired = () => new CloudError('Your sign-in has expired. Sign in again to sync.', { status: 401 });
      let data;
      try {
        data = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } });
      } catch (error) {
        // The server refuses a revoked or used refresh token with a 4xx. A network failure stays as it is.
        if (error instanceof CloudError && error.status >= 400 && error.status < 500) throw expired();
        throw error;
      }
      const session = sessionFrom(data, clock);
      if (!session) throw expired();
      return session;
    },
    /** Ends the server-side session. Local data is untouched, and a failure here is not worth showing. */
    async signOut(accessToken) {
      try {
        await request('/auth/v1/logout', { method: 'POST', token: accessToken });
      } catch {
        // The local session is dropped either way.
      }
    },
  };
}
