import { Router } from 'express';
import { param } from '../../lib/params.js';
import { requirePermission, requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { reviewNoteSchema } from '../projects/schemas.js';
import * as reviews from './reviews.js';

/** Admin area. UC13–UC16 attach here; the review queue serves FR02/FR03. */
export const adminRouter = Router();

adminRouter.use(requireRole('ADMIN'));

adminRouter.get('/ping', (req, res) => {
  res.json({ ok: true, message: `Admin access granted to ${req.user!.name}.` });
});

adminRouter.get('/reviews', requirePermission('review'), async (_req, res) => {
  res.json(await reviews.listReviews());
});

adminRouter.post('/reviews/projects/:id/approve', requirePermission('review'), async (req, res) => {
  await reviews.approveProject(req.user!, param(req, 'id'));
  res.json({ ok: true });
});

adminRouter.post('/reviews/projects/:id/request-changes', requirePermission('review'), validateBody(reviewNoteSchema), async (req, res) => {
  await reviews.requestChanges(req.user!, param(req, 'id'), req.body.note);
  res.json({ ok: true });
});

adminRouter.post('/reviews/revisions/:id/approve', requirePermission('review'), async (req, res) => {
  await reviews.approveRevision(req.user!, param(req, 'id'));
  res.json({ ok: true });
});

adminRouter.post('/reviews/revisions/:id/reject', requirePermission('review'), validateBody(reviewNoteSchema), async (req, res) => {
  await reviews.rejectRevision(req.user!, param(req, 'id'), req.body.note);
  res.json({ ok: true });
});
