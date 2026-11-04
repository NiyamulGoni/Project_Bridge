import bcrypt from 'bcryptjs';
import type { Prisma, User } from '@prisma/client';
import { config } from '../../config.js';
import { BLOCKED_STATUSES, toAuthUser, type AuthUser } from '../../domain.js';
import { audit as writeAudit } from '../../lib/audit.js';
import { HttpError } from '../../lib/errors.js';
import { getGoogleVerifier } from '../../lib/google.js';
import { getMailer } from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';
import { hashToken, randomToken } from '../../lib/tokens.js';

// Compared against when the email is unknown, so response time does not reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('projectbridge-dummy-password', 4);

// Prisma's interactive defaults (2s to get a connection, 5s to finish) are too tight for the remote database.
const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

function audit(action: string, targetId: string | null, actorId: string | null = targetId, reason?: string) {
  return writeAudit({ action, actorId, targetType: 'User', targetId, reason });
}

function assertNotBlocked(user: User): void {
  if (BLOCKED_STATUSES.includes(user.status)) {
    const state = user.status === 'BANNED' ? 'banned' : 'suspended';
    throw new HttpError(
      403,
      'ACCOUNT_DISABLED',
      `This account has been ${state}. Contact the ProjectBridge administrators if you believe this is a mistake.`,
    );
  }
}

async function refuseIfBlocked(user: User): Promise<void> {
  if (BLOCKED_STATUSES.includes(user.status)) await audit('LOGIN_BLOCKED', user.id, user.id, user.status);
  assertNotBlocked(user);
}

/** Starts a server-side session; the returned secret goes into the session cookie. */
async function createSession(user: User, client: Prisma.TransactionClient = prisma): Promise<{ token: string; user: AuthUser }> {
  const token = randomToken();
  await client.session.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + config.sessionTtlMs) },
  });
  return { token, user: toAuthUser(user) };
}

function invalidCredentials(): HttpError {
  return new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
}

function linkAlreadyUsed(): HttpError {
  return new HttpError(400, 'INVALID_TOKEN', 'This link has already been used.');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Registers an Uploader and signs them in straight away. */
export async function register(input: { name: string; email: string; password: string }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.', {
      email: 'An account with this email already exists. Try signing in or resetting your password.',
    });
  }
  const passwordHash = await bcrypt.hash(input.password, config.bcryptRounds);
  // Committed together, so a Google link that can see this account also removes its session.
  const session = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: input.name, email: input.email, passwordHash, role: 'UPLOADER', status: 'ACTIVE' },
    });
    return createSession(user, tx);
  }, TX_OPTIONS);
  await audit('USER_REGISTERED', session.user.id);
  return session;
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Google-only accounts have no password, so they fail here exactly like a wrong password.
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user?.passwordHash || !passwordOk) {
    await audit('LOGIN_FAILED', user?.id ?? null, null, user ? 'wrong password' : 'unknown email');
    throw invalidCredentials();
  }
  await refuseIfBlocked(user);

  const verifiedHash = user.passwordHash;
  const session = await prisma.$transaction(async (tx) => {
    // Locks the user row, so a Google link or password reset either commits later and removes this
    // session, or commits first and this matches nothing. Writing updatedAt back keeps it unchanged.
    const { count } = await tx.user.updateMany({
      where: { id: user.id, passwordHash: verifiedHash },
      data: { updatedAt: user.updatedAt },
    });
    return count === 0 ? null : createSession(user, tx);
  }, TX_OPTIONS);
  if (!session) {
    await audit('LOGIN_FAILED', user.id, null, 'password changed during sign-in');
    throw invalidCredentials();
  }
  await audit('LOGIN_SUCCEEDED', user.id);
  return session;
}

/**
 * Links Google to an account found by email. Registration does not verify the address, so whoever
 * registered it may not be its owner: their password, sessions and unused reset links all go. The
 * Google user can get a password back through forgot-password, which mails that address. The user
 * row comes first, as in every transaction here, so a registration, password sign-in or reset in
 * flight either commits first and is cleared here, or runs afterwards and finds its password or link gone.
 */
async function linkGoogle(userId: string, googleId: string): Promise<User> {
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { googleId, passwordHash: null } }),
    prisma.session.deleteMany({ where: { userId } }),
    prisma.emailToken.deleteMany({ where: { userId, type: 'RESET', usedAt: null } }),
  ]);
  return user;
}

/**
 * Signs in with a Google ID token. The account is found by Google ID, otherwise linked by
 * email (Google has verified the address), otherwise created as a new Uploader.
 */
export async function loginWithGoogle(credential: string) {
  if (!config.googleClientId) {
    throw new HttpError(503, 'GOOGLE_DISABLED', 'Google sign-in is not configured on this server.');
  }
  const identity = await getGoogleVerifier()(credential);
  if (!identity) {
    await audit('LOGIN_FAILED', null, null, 'invalid Google token');
    throw new HttpError(401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in failed. Please try again.');
  }
  if (!identity.emailVerified) {
    throw new HttpError(403, 'GOOGLE_EMAIL_UNVERIFIED', 'Your Google account email is not verified.');
  }

  let user = await prisma.user.findUnique({ where: { googleId: identity.sub } });
  let action = 'LOGIN_GOOGLE';
  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email: identity.email } });
    if (byEmail) {
      // Before any write, so a blocked account stays exactly as it was.
      await refuseIfBlocked(byEmail);
      user = await linkGoogle(byEmail.id, identity.sub);
      action = 'GOOGLE_LINKED';
    } else {
      user = await prisma.user.create({
        data: { name: identity.name.slice(0, 80), email: identity.email, googleId: identity.sub, role: 'UPLOADER' },
      });
      action = 'USER_REGISTERED_GOOGLE';
    }
  }
  await refuseIfBlocked(user);
  await audit(action, user.id);
  return createSession(user);
}

export async function logout(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

/** Always succeeds from the caller's view so it cannot be used to probe for accounts. */
export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || BLOCKED_STATUSES.includes(user.status)) return;

  const token = randomToken();
  await prisma.$transaction([
    // The user row goes first, as in linkGoogle, so the two cannot deadlock. Writing updatedAt back keeps it unchanged.
    prisma.user.update({ where: { id: user.id }, data: { updatedAt: user.updatedAt } }),
    // A new link replaces any earlier unused one.
    prisma.emailToken.deleteMany({ where: { userId: user.id, type: 'RESET', usedAt: null } }),
    prisma.emailToken.create({
      data: {
        userId: user.id,
        type: 'RESET',
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + config.resetTokenTtlMs),
      },
    }),
  ]);
  const link = `${config.appUrl}/reset-password?token=${token}`;
  await getMailer().send({
    to: user.email,
    subject: 'Reset your ProjectBridge password',
    text: `Hi ${user.name},\n\nUse this link to choose a new password:\n${link}\n\nThis link expires in 1 hour. If you did not ask for a reset, ignore this email; your password is unchanged.`,
    html: `<p>Hi ${escapeHtml(user.name)},</p><p>Use this link to choose a new password:</p><p><a href="${link}">Reset my password</a></p><p>This link expires in 1 hour. If you did not ask for a reset, ignore this email; your password is unchanged.</p>`,
  });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const record = await prisma.emailToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!record || record.type !== 'RESET' || record.usedAt || record.expiresAt <= new Date()) {
    throw new HttpError(400, 'INVALID_TOKEN', 'This password reset link is invalid or has expired. Please request a new one.');
  }
  // A blocked account's link is used up, and nothing else on the account changes.
  if (BLOCKED_STATUSES.includes(record.user.status)) {
    const { count } = await prisma.emailToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw linkAlreadyUsed();
    assertNotBlocked(record.user);
  }

  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  await prisma.$transaction(async (tx) => {
    // The user row goes first, as in linkGoogle, so the two cannot deadlock.
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    // Conditional update so two simultaneous requests cannot both use the same token. No match also
    // covers a link cancelled while hashing above, and throwing rolls the new password back.
    const now = new Date();
    const { count } = await tx.emailToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count === 0) throw linkAlreadyUsed();
    // Sign out every device that used the old password.
    await tx.session.deleteMany({ where: { userId: record.userId } });
  }, TX_OPTIONS);
  await audit('PASSWORD_RESET', record.userId);
}
