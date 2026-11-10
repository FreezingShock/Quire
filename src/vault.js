/**
 * Encryption for stored rows. Pure WebCrypto: no DOM and no storage, so the
 * node tests can drive it directly.
 *
 * One random 256-bit data key encrypts every stored entry and version with
 * AES-GCM. That key is kept only wrapped (AES-KW) by a key derived from the
 * passcode with PBKDF2-SHA-256. Changing the passcode re-wraps the data key,
 * so no row has to be encrypted again. A wrong passcode fails the unwrap, so
 * no separate check value is stored.
 *
 * Each row is bound to its id through AES-GCM's additional data. A ciphertext
 * copied onto another row fails to open.
 */

export const PASSCODE_MIN = 6;
export const PASSCODE_MAX = 128;
/** PBKDF2 rounds for new passcodes. Stored with each record, so older records keep working if this changes. */
export const KDF_ITERATIONS = 600000;
const FORMAT = 1;
const IV_BYTES = 12;
const SALT_BYTES = 16;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function subtle() {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error('Passcode lock needs WebCrypto, which this browser does not provide.');
  return api;
}

function randomBytes(length) {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/** Null when the passcode may be used, otherwise a sentence that says why not. */
export function passcodeProblem(passcode) {
  if (typeof passcode !== 'string' || !passcode) return 'Enter a passcode.';
  if (passcode.length < PASSCODE_MIN) return `Use at least ${PASSCODE_MIN} characters.`;
  if (passcode.length > PASSCODE_MAX) return `Use at most ${PASSCODE_MAX} characters.`;
  return null;
}

async function deriveWrapKey(passcode, salt, iterations) {
  const material = await subtle().importKey(
    'raw',
    encoder.encode(passcode.normalize('NFC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/** Wraps `dataKey` under `passcode` with a fresh salt. Returns the record to store. */
async function wrapRecord(dataKey, passcode, iterations) {
  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveWrapKey(passcode, salt, iterations);
  const wrapped = await subtle().wrapKey('raw', dataKey, kek, 'AES-KW');
  return { format: FORMAT, kdf: 'PBKDF2-SHA-256', iterations, salt, wrappedKey: new Uint8Array(wrapped) };
}

/** An open vault: the data key in memory, with seal and open for one row at a time. */
export function createVault(dataKey) {
  const additional = (scope, id) => encoder.encode(`${scope}:${id}`);
  return {
    dataKey,
    async seal(scope, id, value) {
      const iv = randomBytes(IV_BYTES);
      const plain = encoder.encode(JSON.stringify(value));
      const cipher = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: additional(scope, id) }, dataKey, plain);
      return { v: FORMAT, iv, ct: new Uint8Array(cipher) };
    },
    async open(scope, id, sealed) {
      const plain = await subtle().decrypt(
        { name: 'AES-GCM', iv: sealed.iv, additionalData: additional(scope, id) },
        dataKey,
        sealed.ct,
      );
      return JSON.parse(decoder.decode(plain));
    },
  };
}

/**
 * Makes a new lock: a random data key wrapped under the passcode. Returns the
 * record to store and the open vault. `iterations` is for tests only.
 */
export async function createLock(passcode, { iterations = KDF_ITERATIONS } = {}) {
  const problem = passcodeProblem(passcode);
  if (problem) throw new Error(problem);
  const dataKey = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const record = await wrapRecord(dataKey, passcode, iterations);
  return { record, vault: createVault(dataKey) };
}

/** The open vault when the passcode is right, or null when it is wrong. */
export async function unlockLock(record, passcode) {
  if (!record || record.format !== FORMAT) throw new Error('This passcode record was made by a newer Quire.');
  try {
    const kek = await deriveWrapKey(String(passcode ?? ''), record.salt, record.iterations);
    const dataKey = await subtle().unwrapKey(
      'raw',
      record.wrappedKey,
      kek,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    return createVault(dataKey);
  } catch (error) {
    if (error?.name === 'OperationError') return null;
    throw error;
  }
}

/** A new record that wraps the same data key under `passcode`. The stored rows do not change. */
export async function changeLock(vault, passcode) {
  const problem = passcodeProblem(passcode);
  if (problem) throw new Error(problem);
  return wrapRecord(vault.dataKey, passcode, KDF_ITERATIONS);
}
