import { Router } from 'express';
import { param } from '../../lib/params.js';
import { requirePermission } from '../../middleware/auth.js';
import { commentLimiter } from '../../middleware/rateLimit.js';
import { validateBody } from '../../middleware/validate.js';
import { commentSchema } from './schemas.js';
import * as engagement from './service.js';

/**
 * FR08, FR09: likes and comments, for active Professionals only. Mounted under /api/projects; the
 * comments themselves are read through the Professional project view.
 */
export const engagementRouter = Router();

engagementRouter.put('/:id/like', requirePermission('like'), async (req, res) => {
  res.json(await engagement.like(req.user!, param(req, 'id')));
});

engagementRouter.delete('/:id/like', requirePermission('like'), async (req, res) => {
  res.json(await engagement.unlike(req.user!, param(req, 'id')));
});

engagementRouter.post('/:id/comments', requirePermission('comment'), commentLimiter, validateBody(commentSchema), async (req, res) => {
  res.status(201).json(await engagement.addComment(req.user!, param(req, 'id'), req.body.body));
});

engagementRouter.patch('/:id/comments/:commentId', requirePermission('comment'), validateBody(commentSchema), async (req, res) => {
  res.json(await engagement.editComment(req.user!, param(req, 'id'), param(req, 'commentId'), req.body.body));
});

engagementRouter.delete('/:id/comments/:commentId', requirePermission('comment'), async (req, res) => {
  await engagement.deleteComment(req.user!, param(req, 'id'), param(req, 'commentId'));
  res.json({ ok: true });
});
