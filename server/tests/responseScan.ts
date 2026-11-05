/**
 * Shared check that an API response holds nothing it should never hold. Takes the parsed JSON body,
 * so it works on any route and in any later test file.
 */
import { expect } from 'vitest';

/** Keys no response may carry, whatever their value. Matched case-insensitively, anywhere in a key's name. */
export const FORBIDDEN_KEYS = ['email', 'passwordHash', 'tokenHash', 'storagePath', 'googleId', 'sessionId', 'token'];

/** Catches an address in free text or under a new key, even one the test did not list. */
const EMAIL_ADDRESS = /[\w.+-]+@[\w-]+\.[\w.-]+/;

export interface ScanOptions {
  /** Strings that may not appear anywhere in the serialised body: seeded emails, hashes, paths, raw tokens. */
  values?: string[];
  /**
   * Exact paths left out of the scan, with [] for any array index. The two allowed emails are
   * 'user.email' in /api/auth/me and 'submissions[].owner.email' and 'revisions[].owner.email' in the
   * Admin review queue. A test using this should also check the value it let through.
   */
  allow?: string[];
}

const isForbiddenKey = (key: string) => FORBIDDEN_KEYS.some((forbidden) => key.toLowerCase().includes(forbidden.toLowerCase()));

/** Everything forbidden in a response body, described for a failure message. Empty when clean. */
export function scanResponse(body: unknown, { values = [], allow = [] }: ScanOptions = {}): string[] {
  const findings: string[] = [];

  // Notes forbidden keys, and returns a copy without the allowed entries for the value check.
  const walk = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((item) => walk(item, `${path}[]`));
    if (node === null || typeof node !== 'object') return node;
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const at = path ? `${path}.${key}` : key;
      if (allow.includes(at)) continue;
      if (isForbiddenKey(key)) findings.push(`forbidden key at ${at}`);
      kept[key] = walk(value, at);
    }
    return kept;
  };

  const serialised = JSON.stringify(walk(body, '')) ?? '';
  for (const value of values) {
    if (value && serialised.includes(value)) findings.push(`forbidden value: ${value}`);
  }
  const address = serialised.match(EMAIL_ADDRESS);
  if (address) findings.push(`email address: ${address[0]}`);
  return findings;
}

export function expectCleanResponse(body: unknown, options?: ScanOptions): void {
  expect(scanResponse(body, options)).toEqual([]);
}
