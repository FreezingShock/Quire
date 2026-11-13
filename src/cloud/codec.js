/**
 * Turns the byte-carrying shapes (sealed rows, the lock record) into JSON-safe
 * objects for the server, and back. Nothing here decides anything; it only moves
 * bytes in and out of base64.
 */

export function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A vault.seal() result as JSON. */
export function encodeSealed(sealed) {
  return { v: sealed.v, iv: bytesToBase64(sealed.iv), ct: bytesToBase64(sealed.ct) };
}

export function decodeSealed(json) {
  return { v: json.v, iv: base64ToBytes(json.iv), ct: base64ToBytes(json.ct) };
}

/** The passcode lock record (see vault.js) as JSON. `changedAt` says when this copy of the lock last changed. */
export function encodeLock(record) {
  return {
    format: record.format,
    kdf: record.kdf,
    iterations: record.iterations,
    salt: bytesToBase64(record.salt),
    wrappedKey: bytesToBase64(record.wrappedKey),
    changedAt: record.changedAt ?? null,
  };
}

export function decodeLock(json) {
  return {
    format: json.format,
    kdf: json.kdf,
    iterations: json.iterations,
    salt: base64ToBytes(json.salt),
    wrappedKey: base64ToBytes(json.wrappedKey),
    changedAt: json.changedAt ?? null,
  };
}

/** Whether two encoded lock records (from encodeLock) wrap the same key under the same passcode. */
export function sameLock(a, b) {
  return a.salt === b.salt && a.wrappedKey === b.wrappedKey && a.iterations === b.iterations;
}
