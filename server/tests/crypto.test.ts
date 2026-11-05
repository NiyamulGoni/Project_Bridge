/**
 * Field encryption helper. Nothing here touches the database, including the start-up
 * refusal, which exits before the server listens or runs a query.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertEncryptionConfigured, decrypt, encrypt } from '../src/lib/crypto.js';

const CONTEXT = 'Message.body';
const GENERIC_ERROR = 'Could not decrypt the value.';
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const PARTS = { format: 0, version: 1, iv: 2, tag: 3, ciphertext: 4 };

const newKey = () => randomBytes(32).toString('base64');

const originalKeys = process.env.ENCRYPTION_KEYS;

function useKeys(value: string) {
  process.env.ENCRYPTION_KEYS = value;
}

function withPart(stored: string, part: number, value: string): string {
  const parts = stored.split('.');
  parts[part] = value;
  return parts.join('.');
}

/** Changes the first character of a part, which always changes the decoded bytes. */
function flipFirstChar(stored: string, part: number): string {
  const text = stored.split('.')[part]!;
  return withPart(stored, part, `${text[0] === 'A' ? 'B' : 'A'}${text.slice(1)}`);
}

function errorFrom(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected the action to throw.');
}

beforeEach(() => {
  useKeys(`1:${newKey()}`);
});

afterEach(() => {
  process.env.ENCRYPTION_KEYS = originalKeys;
});

describe('encrypt and decrypt', () => {
  it.each([
    ['plain text', 'Hello, project team'],
    ['empty text', ''],
    ['unicode text', 'পরীক্ষা 你好 🔐 é'],
  ])('round trips %s', (_name, plaintext) => {
    expect(decrypt(encrypt(plaintext, CONTEXT), CONTEXT)).toBe(plaintext);
  });

  it('uses the documented stored format', () => {
    const parts = encrypt('hello', CONTEXT).split('.');
    expect(parts).toHaveLength(5);
    expect(parts[PARTS.format]).toBe('pb1');
    expect(parts[PARTS.version]).toBe('1');
    expect(Buffer.from(parts[PARTS.iv]!, 'base64url')).toHaveLength(12);
    expect(Buffer.from(parts[PARTS.tag]!, 'base64url')).toHaveLength(16);
  });

  it('does not store the plaintext', () => {
    const stored = encrypt('a very recognisable sentence', CONTEXT);
    expect(stored).not.toContain('recognisable');
    expect(Buffer.from(stored.split('.')[PARTS.ciphertext]!, 'base64url').toString()).not.toContain('recognisable');
  });

  it('gives a different stored value and IV each time', () => {
    const first = encrypt('same text', CONTEXT);
    const second = encrypt('same text', CONTEXT);
    expect(first).not.toBe(second);
    expect(first.split('.')[PARTS.iv]).not.toBe(second.split('.')[PARTS.iv]);
  });

  it('requires a context', () => {
    expect(() => encrypt('hello', '')).toThrow('context');
    const stored = encrypt('hello', CONTEXT);
    expect(() => decrypt(stored, '')).toThrow(GENERIC_ERROR);
  });
});

describe('rejected values', () => {
  it.each([
    ['IV', PARTS.iv],
    ['auth tag', PARTS.tag],
    ['ciphertext', PARTS.ciphertext],
  ])('rejects a changed %s', (_name, part) => {
    const stored = encrypt('hello', CONTEXT);
    expect(decrypt(stored, CONTEXT)).toBe('hello');
    expect(() => decrypt(flipFirstChar(stored, part), CONTEXT)).toThrow(GENERIC_ERROR);
  });

  it('rejects a changed version even when both versions hold the same key', () => {
    const key = newKey();
    useKeys(`1:${key},2:${key}`);
    const stored = encrypt('hello', CONTEXT);
    expect(stored.split('.')[PARTS.version]).toBe('2');
    expect(() => decrypt(withPart(stored, PARTS.version, '1'), CONTEXT)).toThrow(GENERIC_ERROR);
  });

  it('rejects another spelling of the auth tag that decodes to the same bytes', () => {
    const stored = encrypt('hello', CONTEXT);
    const tag = stored.split('.')[PARTS.tag]!;
    // The last of 22 characters carries 4 unused bits.
    const lastIndex = BASE64URL.indexOf(tag.at(-1)!);
    const respelled = `${tag.slice(0, -1)}${BASE64URL[lastIndex ^ 1]}`;
    expect(Buffer.from(respelled, 'base64url').equals(Buffer.from(tag, 'base64url'))).toBe(true);
    expect(() => decrypt(withPart(stored, PARTS.tag, respelled), CONTEXT)).toThrow(GENERIC_ERROR);
  });

  it('rejects a value copied to another column', () => {
    const stored = encrypt('hello', CONTEXT);
    expect(() => decrypt(stored, 'Message.subject')).toThrow(GENERIC_ERROR);
  });

  it('rejects an unknown version', () => {
    const stored = encrypt('hello', CONTEXT);
    expect(() => decrypt(withPart(stored, PARTS.version, '99'), CONTEXT)).toThrow(GENERIC_ERROR);
  });

  it('rejects a value encrypted with a different key under the same version', () => {
    const stored = encrypt('hello', CONTEXT);
    useKeys(`1:${newKey()}`);
    expect(() => decrypt(stored, CONTEXT)).toThrow(GENERIC_ERROR);
  });

  it('rejects malformed input with the same error', () => {
    const stored = encrypt('hello', CONTEXT);
    const malformed = [
      '',
      'not encrypted',
      'pb1',
      'pb1.1.a.b',
      `${stored}.extra`,
      `${stored}\n`,
      withPart(stored, PARTS.format, 'pb2'),
      withPart(stored, PARTS.version, '01'),
      withPart(stored, PARTS.version, '0'),
      withPart(stored, PARTS.version, 'x'),
      withPart(stored, PARTS.iv, 'AAAA'),
      withPart(stored, PARTS.tag, 'AAAA'),
    ];
    for (const value of malformed) {
      expect(errorFrom(() => decrypt(value, CONTEXT)).message).toBe(GENERIC_ERROR);
    }
  });
});

describe('key rotation', () => {
  it('decrypts old values after a new key is added, and encrypts with the new key', () => {
    const keyOne = newKey();
    useKeys(`1:${keyOne}`);
    const oldValue = encrypt('written before rotation', CONTEXT);
    expect(oldValue.split('.')[PARTS.version]).toBe('1');

    useKeys(`1:${keyOne},2:${newKey()}`);
    expect(decrypt(oldValue, CONTEXT)).toBe('written before rotation');

    const newValue = encrypt('written after rotation', CONTEXT);
    expect(newValue.split('.')[PARTS.version]).toBe('2');
    expect(decrypt(newValue, CONTEXT)).toBe('written after rotation');
  });

  it('uses the highest version whatever the order of the list', () => {
    useKeys(`3:${newKey()},1:${newKey()}`);
    expect(encrypt('hello', CONTEXT).split('.')[PARTS.version]).toBe('3');
  });

  it('cannot read a value once its key is removed', () => {
    const stored = encrypt('hello', CONTEXT);
    useKeys(`2:${newKey()}`);
    expect(() => decrypt(stored, CONTEXT)).toThrow(GENERIC_ERROR);
  });
});

describe('key configuration', () => {
  const shortKey = randomBytes(16).toString('base64');
  const longKey = randomBytes(33).toString('base64');
  // 32 bytes of zero, with an unused bit set: decodes fine but is not the exact encoding.
  const respelledKey = `${'A'.repeat(42)}B=`;

  it.each([
    ['a key that is too short', `1:${shortKey}`, shortKey],
    ['a key that is too long', `1:${longKey}`, longKey],
    ['bad base64', '1:not*valid*base64', 'not*valid*base64'],
    ['base64url instead of base64', `1:${'_'.repeat(43)}=`, '_'.repeat(43)],
    ['a key with spare bits set', `1:${respelledKey}`, respelledKey],
    ['an empty key', '1:', undefined],
    ['a duplicate version', `1:${'A'.repeat(43)}=,1:${'B'.repeat(43)}=`, 'BBBBBBBB'],
    ['a non-numeric version', `abc:${'A'.repeat(43)}=`, 'AAAAAAAA'],
    ['a zero version', `0:${'A'.repeat(43)}=`, 'AAAAAAAA'],
    ['a negative version', `-1:${'A'.repeat(43)}=`, 'AAAAAAAA'],
    ['a decimal version', `1.5:${'A'.repeat(43)}=`, 'AAAAAAAA'],
    ['a version with a leading zero', `01:${'A'.repeat(43)}=`, 'AAAAAAAA'],
    ['a version too large to be exact', `9007199254740993:${'A'.repeat(43)}=`, 'AAAAAAAA'],
    ['no version at all', 'A'.repeat(43) + '=', 'AAAAAAAA'],
    ['a trailing comma', `1:${'A'.repeat(43)}=,`, 'AAAAAAAA'],
  ])('rejects %s without printing the key', (_name, value, keyText) => {
    useKeys(value);
    const error = errorFrom(assertEncryptionConfigured);
    expect(error.message).toContain('ENCRYPTION_KEYS');
    if (keyText) expect(error.message).not.toContain(keyText);
    // Encryption must refuse too, not only the start-up check.
    expect(() => encrypt('hello', CONTEXT)).toThrow('ENCRYPTION_KEYS');
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('treats %s as missing, and says how to generate a key on first use', (_name, value) => {
    if (value === undefined) delete process.env.ENCRYPTION_KEYS;
    else useKeys(value);
    for (const action of [
      assertEncryptionConfigured,
      () => encrypt('hello', CONTEXT),
      () => decrypt('pb1.1.a.b.c', CONTEXT),
    ]) {
      const { message } = errorFrom(action);
      expect(message).toContain('ENCRYPTION_KEYS');
      expect(message).toContain('openssl rand -base64 32');
    }
  });

  it('accepts valid keys', () => {
    useKeys(`1:${newKey()},2:${newKey()}`);
    expect(() => assertEncryptionConfigured()).not.toThrow();
  });
});

describe('error messages', () => {
  it('hold no key, plaintext or stored value for any decrypt failure', () => {
    const key = newKey();
    const plaintext = 'a private message';
    useKeys(`1:${key}`);
    const stored = encrypt(plaintext, CONTEXT);

    const failures = [
      () => decrypt(stored, 'Message.subject'),
      () => decrypt(flipFirstChar(stored, PARTS.ciphertext), CONTEXT),
      () => decrypt(withPart(stored, PARTS.version, '99'), CONTEXT),
      () => decrypt(plaintext, CONTEXT),
    ];
    for (const failure of failures) {
      const error = errorFrom(failure);
      expect(error.message).toBe(GENERIC_ERROR);
      expect(error.cause).toBeUndefined();
      for (const secret of [key, plaintext, stored]) {
        expect(String(error.stack)).not.toContain(secret);
      }
    }
  });
});

describe('production start-up', () => {
  const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  /** The timeout only matters if the refusal breaks and the server stays up. */
  function startProductionServer(encryptionKeys: string, overrides: NodeJS.ProcessEnv = {}) {
    return new Promise<{ code: number | string | null | undefined; output: string }>((done) => {
      execFile(
        process.execPath,
        ['--import', 'tsx', 'src/index.ts'],
        {
          cwd: serverRoot,
          timeout: 25000,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            APP_URL: 'https://example.test',
            TRUST_PROXY: 'loopback',
            PORT: '0',
            ENCRYPTION_KEYS: encryptionKeys,
            ...overrides,
          },
        },
        (error, stdout, stderr) => done({ code: error?.code ?? 0, output: `${stdout}\n${stderr}` }),
      );
    });
  }

  it('refuses to start when ENCRYPTION_KEYS is empty', async () => {
    const { code, output } = await startProductionServer('');
    expect(code).toBe(1);
    // The reason matters: any crash would also exit non-zero.
    expect(output).toContain('Refusing to start');
    expect(output).toContain('ENCRYPTION_KEYS is not set');
    expect(output).not.toContain('listening');
    // The key from the surrounding test environment must not appear either.
    expect(output).not.toContain(originalKeys!.slice(2));
  });

  it('refuses to start when NODE_ENV is empty, rather than running without production protection', async () => {
    // An empty value stays empty: dotenv does not override a variable that is already set.
    const { code, output } = await startProductionServer(originalKeys!, { NODE_ENV: '' });
    expect(code).toBe(1);
    expect(output).toContain('NODE_ENV is not set');
    expect(output).not.toContain('listening');
  });

  it('refuses to start with an invalid key, and does not print it', async () => {
    const badKey = randomBytes(16).toString('base64');
    const { code, output } = await startProductionServer(`1:${badKey}`);
    expect(code).toBe(1);
    expect(output).toContain('Refusing to start');
    expect(output).toContain('must decode to exactly 32 bytes');
    expect(output).not.toContain('listening');
    expect(output).not.toContain(badKey);
  });
});
