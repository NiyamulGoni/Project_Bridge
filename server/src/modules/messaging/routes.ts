import { Router } from 'express';
import { HttpError } from '../../lib/errors.js';
import { param } from '../../lib/params.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { contactLimiter, messageLimiter } from '../../middleware/rateLimit.js';
import { validateBody } from '../../middleware/validate.js';
import * as conversations from './conversations.js';
import { createRequestSchema, listRequestsQuery } from './schemas.js';
import * as messaging from './service.js';

/**
 * FR10: contact requests and the private conversations they open. A request someone is not party to is a 404.
 * Declining and withdrawing stay open to RESTRICTED accounts, so they can still say no.
 */
export const messagingRouter = Router();

messagingRouter.post('/requests', requirePermission('contact'), contactLimiter, validateBody(createRequestSchema), async (req, res) => {
  res.status(201).json(await messaging.createRequest(req.user!, req.body));
});

messagingRouter.get('/requests', requireAuth, async (req, res) => {
  const parsed = listRequestsQuery.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request list query.');
  res.json(await messaging.listRequests(req.user!, parsed.data));
});

messagingRouter.post('/requests/:id/accept', requirePermission('contact'), async (req, res) => {
  res.json(await messaging.acceptRequest(req.user!, param(req, 'id')));
});

messagingRouter.post('/requests/:id/decline', requireAuth, async (req, res) => {
  res.json(await messaging.declineRequest(req.user!, param(req, 'id')));
});

messagingRouter.post('/requests/:id/withdraw', requireAuth, async (req, res) => {
  res.json(await messaging.withdrawRequest(req.user!, param(req, 'id')));
});

messagingRouter.get('/conversations', requireAuth, async (req, res) => {
  res.json(await conversations.listConversations(req.user!));
});

messagingRouter.get('/conversations/:id/messages', requireAuth, async (req, res) => {
  const parsed = conversations.messagesQuery.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid cursor.');
  res.json(await conversations.listMessages(req.user!, param(req, 'id'), parsed.data.cursor));
});

// RESTRICTED accounts can still read, but the message permission stops them sending.
messagingRouter.post('/conversations/:id/messages', requirePermission('message'), messageLimiter, validateBody(conversations.messageSchema), async (req, res) => {
  res.status(201).json(await conversations.sendMessage(req.user!, param(req, 'id'), req.body.body));
});
