import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../lib/errors.js';
import { param } from '../../lib/params.js';
import { requireAuth } from '../../middleware/auth.js';
import * as notifications from './service.js';

/** In-app notices (DFD 8.0). Every query is limited to the signed-in user's own. */
export const notificationsRouter = Router();

const listQuery = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) });

notificationsRouter.get('/', requireAuth, async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid page number.');
  res.json(await notifications.listNotifications(req.user!, parsed.data.page));
});

notificationsRouter.get('/unread-count', requireAuth, async (req, res) => {
  res.json({ count: await notifications.unreadCount(req.user!) });
});

notificationsRouter.post('/read-all', requireAuth, async (req, res) => {
  await notifications.markAllRead(req.user!);
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', requireAuth, async (req, res) => {
  await notifications.markRead(req.user!, param(req, 'id'));
  res.json({ ok: true });
});
