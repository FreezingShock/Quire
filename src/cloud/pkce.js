/**
 * PKCE helpers (RFC 7636) for the browser sign-in. The app keeps no client
 * secret: it makes a random verifier, sends its SHA-256 challenge with the
 * sign-in request, and proves it holds the verifier when it swaps the code.
 */

const encoder = new TextEncoder();

export function base64UrlFromBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A random verifier of 43 to 128 unreserved characters. */
export function randomVerifier(byteLength = 48) {
  return base64UrlFromBytes(globalThis.crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** The S256 challenge for a verifier. */
export async function challengeFor(verifier) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return base64UrlFromBytes(new Uint8Array(digest));
}
