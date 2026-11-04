import { createHash, randomBytes } from 'node:crypto';

/** URL-safe random secret sent to the browser or by email. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only hashes of secrets are stored, so a database leak does not expose live tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
