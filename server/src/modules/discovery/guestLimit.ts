import type { GuestSession } from '@prisma/client';
import type { Request, Response } from 'express';
import { config } from '../../config.js';
import { HttpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { hashToken, randomToken } from '../../lib/tokens.js';

export const GUEST_COOKIE = 'pb_guest';

/**
 * Finds or starts the anonymous browsing session. The cap is measured per anonymous
 * session, not per verified person (proposal Section 4.2).
 */
export async function getGuestSession(req: Request, res: Response) {
  const existing: string | undefined = req.cookies?.[GUEST_COOKIE];
  if (existing) {
    const session = await prisma.guestSession.findUnique({ where: { tokenHash: hashToken(existing) } });
    if (session) return session;
  }
  const token = randomToken();
  res.cookie(GUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  return prisma.guestSession.create({ data: { tokenHash: hashToken(token) } });
}

/** Records the furthest feed position this guest has been shown, and which projects. */
export async function recordGuestExposure(sessionId: string, reachedPosition: number, projectIds: string[] = []): Promise<number> {
  const session = await prisma.guestSession.findUniqueOrThrow({ where: { id: sessionId } });
  const cardsServed = Math.max(session.cardsServed, reachedPosition);
  const seenProjectIds = [...new Set([...session.seenProjectIds, ...projectIds])];
  await prisma.guestSession.update({ where: { id: sessionId }, data: { cardsServed, seenProjectIds } });
  return cardsServed;
}

/**
 * FR05/FR07: a guest may reopen any project they were already shown, but opening a new one
 * by direct link draws on the same 20-card budget.
 */
export async function admitGuestToProject(session: GuestSession, projectId: string): Promise<void> {
  if (session.seenProjectIds.includes(projectId)) return;
  const limit = guestCardLimit();
  if (session.seenProjectIds.length >= limit || session.cardsServed >= limit) {
    throw new HttpError(403, 'GUEST_LIMIT', `Guests can browse ${limit} projects. Sign in or register to keep exploring.`);
  }
  await prisma.guestSession.update({ where: { id: session.id }, data: { seenProjectIds: { push: projectId } } });
}

export const guestCardLimit = () => config.guestCardLimit;
