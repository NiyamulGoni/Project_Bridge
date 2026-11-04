import { Router } from 'express';
import { config } from '../../config.js';
import { requireAuth } from '../../middleware/auth.js';
import { authEmailLimiter, loginLimiter } from '../../middleware/rateLimit.js';
import { clearSessionCookie, setSessionCookie } from '../../middleware/session.js';
import { validateBody } from '../../middleware/validate.js';
import { emailOnlySchema, googleSchema, loginSchema, registerSchema, resetPasswordSchema } from './schemas.js';
import * as accounts from './service.js';

/** FR01 / UC01: account access. */
export const accountsRouter = Router();

/** Tells the client which sign-in options this server supports. */
accountsRouter.get('/config', (_req, res) => {
  res.json({ googleEnabled: Boolean(config.googleClientId) });
});

accountsRouter.post('/register', authEmailLimiter, validateBody(registerSchema), async (req, res) => {
  const { token, user } = await accounts.register(req.body);
  setSessionCookie(res, token);
  res.status(201).json({ user });
});

accountsRouter.post('/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
  const { token, user } = await accounts.login(req.body.email, req.body.password);
  setSessionCookie(res, token);
  res.json({ user });
});

accountsRouter.post('/google', loginLimiter, validateBody(googleSchema), async (req, res) => {
  const { token, user } = await accounts.loginWithGoogle(req.body.credential);
  setSessionCookie(res, token);
  res.json({ user });
});

accountsRouter.post('/logout', async (req, res) => {
  if (req.sessionId) await accounts.logout(req.sessionId);
  clearSessionCookie(res);
  res.status(204).end();
});

accountsRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

accountsRouter.post('/forgot-password', authEmailLimiter, validateBody(emailOnlySchema), async (req, res) => {
  await accounts.forgotPassword(req.body.email);
  res.json({ message: 'If an account exists for that email, a password reset link is on its way.' });
});

accountsRouter.post('/reset-password', authEmailLimiter, validateBody(resetPasswordSchema), async (req, res) => {
  await accounts.resetPassword(req.body.token, req.body.password);
  clearSessionCookie(res);
  res.json({ message: 'Your password has been changed. Please sign in with the new password.' });
});
