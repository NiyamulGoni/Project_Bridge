import type { CookieOptions, RequestHandler, Response } from 'express';
import { config } from '../config.js';
import { BLOCKED_STATUSES, toAuthUser, type AuthUser } from '../domain.js';
import { prisma } from '../lib/prisma.js';
import { hashToken } from '../lib/tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}

export const SESSION_COOKIE = 'pb_session';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
  path: '/',
};

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: config.sessionTtlMs });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}

/**
 * Resolves the session cookie on every request. Account state is re-read each time, so a
 * suspension or ban takes effect on the next protected request (NFR-S3).
 */
export const loadSession: RequestHandler = async (req, res, next) => {
  // cookie-parser turns a "j:" value into an object, which is never one of our tokens.
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || !token) return next();

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    clearSessionCookie(res);
    return next();
  }

  if (BLOCKED_STATUSES.includes(session.user.status)) {
    await prisma.session.deleteMany({ where: { userId: session.userId } });
    clearSessionCookie(res);
    return next();
  }

  req.user = toAuthUser(session.user);
  req.sessionId = session.id;
  next();
};
