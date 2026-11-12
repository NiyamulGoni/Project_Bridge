import type { GuestSession, Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { config } from '../../config.js';
import { HttpError } from '../../lib/errors.js';
import { prisma, TX_OPTIONS } from '../../lib/prisma.js';
import { hashToken, randomToken } from '../../lib/tokens.js';
import { ELIGIBLE, NEWEST_FIRST } from './visibility.js';

export const GUEST_COOKIE = 'pb_guest';

export const guestCardLimit = () => config.guestCardLimit;

export function guestLimitReached(): HttpError {
  return new HttpError(403, 'GUEST_LIMIT', `Guests can browse ${guestCardLimit()} projects. Sign in or register to keep exploring.`);
}

/**
 * Finds or starts the anonymous browsing session. The cap is measured per anonymous session, not
 * per verified person (proposal Section 4.2), so clearing cookies starts a new budget. SRS 4.6
 * accepts that limit.
 */
export async function getGuestSession(req: Request, res: Response) {
  // cookie-parser turns a "j:" value into an object, which is never one of our tokens.
  const existing: unknown = req.cookies?.[GUEST_COOKIE];
  if (typeof existing === 'string' && existing) {
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

/**
 * Locks the session row, then reads it. The lock comes first, as in login, so parallel requests from
 * one session decide one at a time and each sees what the last one recorded.
 */
async function lockGuestSession(tx: Prisma.TransactionClient, sessionId: string): Promise<GuestSession> {
  await tx.guestSession.updateMany({ where: { id: sessionId }, data: { lastSeenAt: new Date() } });
  return tx.guestSession.findUniqueOrThrow({ where: { id: sessionId } });
}

/**
 * FR05: one page of the feed, drawn from the session's single budget of distinct projects (SRS 6.2),
 * which direct links share. A guest pages through the projects already shown plus, while the budget
 * lasts, the newest ones not shown yet. Revisiting a page costs nothing, and newly published projects
 * cannot take the guest past the limit or push what they have seen out of reach.
 *
 * FR06: a guest's name/tag search uses this same budget, through `filter`: results already seen are
 * free, new ones are charged, so searching can never show a guest more than the feed would.
 */
export async function guestFeedPage(sessionId: string, offset: number, pageSize: number, filter: Prisma.ProjectWhereInput = {}) {
  const limit = guestCardLimit();
  const take = Math.min(pageSize, limit - offset);
  return prisma.$transaction(async (tx) => {
    const { seenProjectIds: seen } = await lockGuestSession(tx, sessionId);
    const room = Math.max(limit - seen.length, 0);
    // One more than the budget can buy, to tell whether anything lies beyond it.
    const unseen = await tx.project.findMany({
      where: { ...ELIGIBLE, ...filter, id: { notIn: seen } },
      orderBy: NEWEST_FIRST,
      select: { id: true },
      take: room + 1,
    });
    const rows = await tx.project.findMany({
      where: { ...ELIGIBLE, ...filter, id: { in: [...seen, ...unseen.slice(0, room).map((p) => p.id)] } },
      orderBy: NEWEST_FIRST,
      include: { owner: { select: { name: true } } },
      skip: offset,
      take: take + 1,
    });
    const page = rows.slice(0, take);

    const seenNow = [...new Set([...seen, ...page.map((p) => p.id)])];
    const cardsServed = Math.min(seenNow.length, limit);
    if (seenNow.length > seen.length) {
      await tx.guestSession.update({ where: { id: sessionId }, data: { seenProjectIds: seenNow, cardsServed } });
    }

    const hasMore = rows.length > take && offset + take < limit;
    // More projects exist, but this guest has reached the end of what the budget allows.
    const capReached = !hasMore && (rows.length > take || unseen.length > room);
    return { rows: page, hasMore, cardsServed, capReached };
  }, TX_OPTIONS);
}

/**
 * FR05/FR07: a guest may reopen any project they were already shown, but opening a new one by
 * direct link draws on the same budget as the feed.
 */
export async function admitGuestToProject(session: GuestSession, projectId: string): Promise<void> {
  const limit = guestCardLimit();
  // The list only ever grows, so an answer from this earlier read cannot go stale.
  if (session.seenProjectIds.includes(projectId)) return;
  if (session.seenProjectIds.length >= limit) throw guestLimitReached();

  const admitted = await prisma.$transaction(async (tx) => {
    const { seenProjectIds: seen } = await lockGuestSession(tx, session.id);
    if (seen.includes(projectId)) return true;
    if (seen.length >= limit) return false;
    await tx.guestSession.update({
      where: { id: session.id },
      data: { seenProjectIds: [...seen, projectId], cardsServed: seen.length + 1 },
    });
    return true;
  }, TX_OPTIONS);
  if (!admitted) throw guestLimitReached();
}
