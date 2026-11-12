import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { config } from '../config.js';

const message = (msg: string) => ({ error: { code: 'RATE_LIMITED', message: msg } });
const WINDOW_MS = 15 * 60 * 1000;

/** NFR-S1: failed sign-ins are limited per address and email; successful ones are not counted. */
export const loginLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: config.loginMaxAttempts,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `${ipKeyGenerator(req.ip ?? '')}|${email}`;
  },
  message: message('Too many failed sign-in attempts. Please wait 15 minutes and try again.'),
});

/** Invites say whether an address has an account, so they get the same throttle as register, per signed-in user. */
export const inviteLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: config.inviteRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.user!.id,
  message: message('Too many invitations. Please wait a few minutes and try again.'),
});

/** Per signed-in user, so one account cannot flood the Admin queue. */
export const reportLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: config.reportRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.user!.id,
  message: message('Too many reports. Please wait a few minutes and try again.'),
});

/** Per signed-in user, against comment spam. */
export const commentLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: config.commentRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.user!.id,
  message: message('Too many comments. Please wait a few minutes and try again.'),
});

/** Per signed-in user, so one account cannot flood others with requests. */
export const contactLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: config.contactRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.user!.id,
  message: message('Too many contact requests. Please wait a few minutes and try again.'),
});

/** Per signed-in user, against message flooding. */
export const messageLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: config.messageRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.user!.id,
  message: message('Too many messages. Please wait a few minutes and try again.'),
});

/** Registration, resend and password-reset requests, which trigger emails. */
export const authEmailLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: config.authRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: message('Too many requests. Please wait a few minutes and try again.'),
});
