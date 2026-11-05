import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Field encryption: AES-256-GCM, stored as pb1.<version>.<iv>.<tag>.<ciphertext> (base64url).
 * The context (e.g. 'Message.body') and key version are authenticated, so a value copied
 * to another column or edited in place fails to decrypt.
 */
const FORMAT = 'pb1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const STORED_VALUE = /^pb1\.([1-9]\d*)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/;
const VERSION = /^[1-9]\d*$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const GENERATE_HINT = 'Generate a key with: openssl rand -base64 32, then set ENCRYPTION_KEYS=1:<key> in server/.env.';
/** The only decrypt failure message, so it reveals nothing about the value or the cause. */
const DECRYPT_FAILED = 'Could not decrypt the value.';

interface KeyRing {
  keys: Map<number, Buffer>;
  currentVersion: number;
}

/** Entries are named by position only: a malformed entry might be the key itself. */
function parseKeyRing(raw: string): KeyRing {
  const keys = new Map<number, Buffer>();

  raw.split(',').forEach((entry, index) => {
    const label = `ENCRYPTION_KEYS entry ${index + 1}`;
    const separator = entry.indexOf(':');
    if (separator === -1) {
      throw new Error(`${label} must look like <version>:<base64 key>. ${GENERATE_HINT}`);
    }

    const versionText = entry.slice(0, separator);
    const version = Number(versionText);
    if (!VERSION.test(versionText) || !Number.isSafeInteger(version)) {
      throw new Error(`${label} has a version that is not a positive integer.`);
    }
    if (keys.has(version)) {
      throw new Error(`${label} repeats a version that is already in use.`);
    }

    // Buffer.from skips bad characters silently, so require the exact encoding of the bytes.
    const keyText = entry.slice(separator + 1);
    const key = Buffer.from(keyText, 'base64');
    if (!BASE64.test(keyText) || key.toString('base64') !== keyText) {
      throw new Error(`${label} is not valid base64. ${GENERATE_HINT}`);
    }
    if (key.length !== KEY_BYTES) {
      throw new Error(`${label} must decode to exactly ${KEY_BYTES} bytes. ${GENERATE_HINT}`);
    }

    keys.set(version, key);
  });

  return { keys, currentVersion: Math.max(...keys.keys()) };
}

let cached: { raw: string; ring: KeyRing } | undefined;

/** Read on first use, so nothing fails until encryption is needed, and kept until the variable changes. */
function keyRing(): KeyRing {
  const raw = process.env.ENCRYPTION_KEYS ?? '';
  if (cached?.raw === raw) return cached.ring;
  if (!raw.trim()) {
    throw new Error(`ENCRYPTION_KEYS is not set. ${GENERATE_HINT}`);
  }
  const ring = parseKeyRing(raw);
  cached = { raw, ring };
  return ring;
}

function additionalData(version: number, context: string): Buffer {
  return Buffer.from(`${FORMAT}:${version}:${context}`, 'utf8');
}

/** Buffer.from ignores a part's spare trailing bits, so an altered encoding must not decode to the same bytes. */
function decodePart(text: string, expectedBytes?: number): Buffer {
  const bytes = Buffer.from(text, 'base64url');
  if (bytes.toString('base64url') !== text) throw new Error(DECRYPT_FAILED);
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) throw new Error(DECRYPT_FAILED);
  return bytes;
}

/** Throws a clear error if the keys are missing or invalid. The message never holds key material. */
export function assertEncryptionConfigured(): void {
  keyRing();
}

/** Encrypts with the highest key version. */
export function encrypt(plaintext: string, context: string): string {
  if (!context) throw new Error('encrypt() needs a context, e.g. "Message.body".');

  const { keys, currentVersion } = keyRing();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keys.get(currentVersion)!, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(additionalData(currentVersion, context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    FORMAT,
    currentVersion,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/** Decrypts with the version stored in the value. A key configuration problem keeps its own clear error. */
export function decrypt(stored: string, context: string): string {
  const { keys } = keyRing();

  try {
    const match = STORED_VALUE.exec(stored);
    if (!match || !context) throw new Error(DECRYPT_FAILED);
    const [versionText, ivText, tagText, ciphertextText] = match.slice(1) as [string, string, string, string];

    const version = Number(versionText);
    const key = keys.get(version);
    if (!key) throw new Error(DECRYPT_FAILED);

    const decipher = createDecipheriv(ALGORITHM, key, decodePart(ivText, IV_BYTES), { authTagLength: TAG_BYTES });
    decipher.setAAD(additionalData(version, context));
    decipher.setAuthTag(decodePart(tagText, TAG_BYTES));
    return Buffer.concat([decipher.update(decodePart(ciphertextText)), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(DECRYPT_FAILED);
  }
}
