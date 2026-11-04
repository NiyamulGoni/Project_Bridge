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

const client = new OAuth2Client();

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
