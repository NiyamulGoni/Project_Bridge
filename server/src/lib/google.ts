import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';

export interface GoogleIdentity {
  /** Google's stable account ID ("sub"). */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/** Returns the identity for a valid ID token, or null if it is invalid or meant for another app. */
export type GoogleVerifier = (idToken: string) => Promise<GoogleIdentity | null>;

/** Fail fast instead of hanging when Google's key host cannot be reached. */
const client = new OAuth2Client({ transporterOptions: { timeout: 6000 } });

const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

/** True when verification failed because Google's signing keys could not be fetched, not because the token is bad. */
function keysUnreachable(err: unknown): boolean {
  const e = err as { code?: unknown; message?: string; name?: string };
  const code = String(e?.code ?? '');
  return (
    /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR/.test(code) ||
    /retrieve verification certificates|timeout|network|ETIMEDOUT|ENOTFOUND/i.test(e?.message ?? '')
  );
}

/**
 * Fallback for networks that block www.googleapis.com, the only host that serves Google's signing
 * keys. Google's tokeninfo endpoint (a different host) checks the signature and expiry for us; we
 * still check the audience, issuer and expiry ourselves.
 */
async function verifyWithTokenInfo(idToken: string): Promise<GoogleIdentity | null> {
  const res = await fetch(TOKENINFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const t = (await res.json()) as Record<string, string | undefined>;
  if (t.aud !== config.googleClientId || !t.iss || !ISSUERS.has(t.iss)) return null;
  if (!t.exp || Number(t.exp) * 1000 <= Date.now()) return null;
  if (!t.sub || !t.email) return null;
  return {
    sub: t.sub,
    email: t.email.toLowerCase(),
    emailVerified: String(t.email_verified) === 'true',
    name: t.name ?? t.email.split('@')[0],
  };
}

/** Checks the token's signature, expiry, issuer and audience (our client ID) with Google's keys. */
export const verifyWithGoogle: GoogleVerifier = async (idToken) => {
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: config.googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) return null;
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: payload.name ?? payload.email.split('@')[0],
    };
  } catch (err) {
    if (keysUnreachable(err)) {
      console.warn('[google] signing keys unreachable; verifying with tokeninfo instead');
      try {
        return await verifyWithTokenInfo(idToken);
      } catch (fallbackErr) {
        console.warn(`[google] tokeninfo fallback failed: ${(fallbackErr as Error).message}`);
        return null;
      }
    }
    console.warn(`[google] ID token rejected: ${(err as Error).message}`);
    return null;
  }
};

let current: GoogleVerifier = verifyWithGoogle;

export function getGoogleVerifier(): GoogleVerifier {
  return current;
}

/** Lets the tests replace Google with a stub. */
export function setGoogleVerifier(verifier: GoogleVerifier): void {
  current = verifier;
}
